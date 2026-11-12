import { jira, JiraError } from "./jira";
import { ESTIMATES, ledger, refresh } from "./mirror";
import { DESCRIPTION_CONFLICT, renameCommentIds, type Op } from "./jira-ops";
import { adfToText } from "./document";

const at = (key: string) => `/rest/api/3/issue/${encodeURIComponent(key)}`;

type Fields = Extract<Op, { op: "fields" }>["fields"];
/** Jira field payload for edited or created fields. */
function fieldPayload(fields: Fields) {
  const out: Record<string, unknown> = {};
  if (fields.summary !== undefined) out.summary = fields.summary;
  if (fields.description !== undefined) out.description = fields.description;
  if (fields.priority !== undefined)
    out.priority = fields.priority ? { name: fields.priority } : null;
  if (fields.assignee !== undefined)
    out.assignee = fields.assignee ? { accountId: fields.assignee } : null;
  if (fields.labels !== undefined) out.labels = fields.labels;
  if (fields.due !== undefined) out.duedate = fields.due;
  if (fields.parent !== undefined) out.parent = fields.parent ? { key: fields.parent } : null;
  if (fields.milestones !== undefined) out.fixVersions = fields.milestones.map((id) => ({ id }));
  if (fields.type !== undefined) out.issuetype = { name: fields.type };
  if (fields.estimate !== undefined) {
    if (!ESTIMATES[0]) throw new UserError("This Jira site has no story points field.");
    out[ESTIMATES[0]] = fields.estimate;
  }
  return out;
}

export class UserError extends Error {}

let linkTypes: Promise<{ name: string; inward: string; outward: string }[]> | undefined;
/** Jira's link type for an app relation kind. */
async function linkType(kind: string) {
  const types = await (linkTypes ??= jira<{ issueLinkTypes: any[] }>(
    "/rest/api/3/issueLinkType",
  ).then(
    (r) => r.issueLinkTypes,
    (e) => {
      linkTypes = undefined;
      throw e;
    },
  ));
  const pattern = /block/.test(kind) ? /block/i : /duplicat/.test(kind) ? /duplicat/i : /relat/i;
  const type = types.find((t) => pattern.test(t.name));
  if (!type) throw new UserError(`This Jira site has no link type for "${kind}".`);
  return type;
}
/** `from` blocks/duplicates/relates to `to`: Jira shows the outward description on the inward issue's side. */
const linkEnds = (key: string, target: string, kind: string) =>
  kind === "blocked" || kind === "duplicated"
    ? { outward: target, inward: key }
    : { outward: key, inward: target };

/** Sub-issues of a standard issue must use the project's subtask type. */
async function typeFor(project: string, type: string | undefined, parent: string | undefined) {
  if (!parent) return type ?? "Task";
  // Both reads at once: a child create waits one Jira round trip here, not two (R2-create-D2).
  const meta = jira<{ issueTypes: any[] }>(
    `/rest/api/3/issue/createmeta/${encodeURIComponent(project)}/issuetypes`,
  );
  meta.catch(() => {});
  const parentType = (await jira(`${at(parent)}?fields=issuetype`)).fields.issuetype;
  if (parentType.hierarchyLevel > 0) return type && type !== "Subtask" ? type : "Task";
  const { issueTypes } = await meta;
  const subtask = issueTypes.find((t) => t.subtask);
  if (!subtask) throw new UserError(`Project ${project} has no sub-task issue type.`);
  return subtask.name as string;
}

async function transition(key: string, status: string) {
  // Both reads at once (R2-create-D2).
  const [current, { transitions }] = await Promise.all([
    jira<{ fields: { status: { id: string } } }>(`${at(key)}?fields=status`),
    jira<{ transitions: { id: string; to: { id: string } }[] }>(`${at(key)}/transitions`),
  ]);
  if (current.fields.status.id === status) return;
  const found = transitions.find((t) => t.to.id === status);
  if (!found)
    throw new UserError(
      "Jira's workflow has no transition from the current status to that status.",
    );
  await jira(`${at(key)}/transitions`, {
    method: "POST",
    body: JSON.stringify({ transition: { id: found.id } }),
  });
}

type Context = {
  key: string;
  created: Record<string, string>;
  touched: Set<string>;
  warning?: string;
  /** An earlier send of these ops may have reached Jira: a resend, or a replayed create. */
  replay?: boolean;
};
/** Whether Jira still has the thing at `path`. */
const stillThere = (path: string) =>
  jira(path).then(
    () => true,
    (e) => {
      if (e instanceof JiraError && e.status === 404) return false;
      throw e;
    },
  );
/** The entity property a create carries its client id in, so a send whose answer was lost can be found in Jira. */
const TAG = "better-jira";
const tag = (client: string | undefined) =>
  client ? { properties: [{ key: TAG, value: { client } }] } : {};
const tagged = (properties: any, client: string) =>
  Array.isArray(properties)
    ? properties.some((p) => p?.key === TAG && p.value?.client === client)
    : properties?.[TAG]?.client === client;
/**
 * Jira's search index trails a create, sometimes by minutes: an issue intent younger than this that search can't find
 * is not taken as absent. The write answers "retry later" and the tab sends it again, rather than create a second issue.
 */
export const SEARCH_WAIT_MS = 5 * 60_000;
/** Sent again later: what an earlier send made can't be told yet. */
export class RetryLater extends Error {}
let me: Promise<string> | undefined;
const myself = () =>
  (me ??= jira<{ accountId: string }>("/rest/api/3/myself").then(
    (r) => r.accountId,
    (e) => {
      me = undefined;
      throw e;
    },
  ));
/** Jira refused it outright (not a lost answer, a timeout or a rate limit): nothing was made. */
const refusedOutright = (e: unknown) =>
  e instanceof UserError ||
  (e instanceof JiraError &&
    e.status >= 400 &&
    e.status < 500 &&
    e.status !== 408 &&
    e.status !== 429);
type Made = { id: string; replay: boolean; data?: any; found: boolean };
type Intent = NonNullable<ReturnType<typeof ledger.made>>;
const making = new Map<string, Promise<unknown>>();
/**
 * Jira's creates (issue, comment, attachment) have no idempotency key, so what `client` made is kept, and a replay
 * (another tab, a reload, a retry after a lost answer) gets it back while `exists` says Jira still has it. The intent,
 * with `data` (what the send starts from), is recorded before the send: if the answer never came, `find` looks for what
 * the send made before sending again. Sends of one client run one at a time, so two at once never both create
 * (R2-create-D1, sync D1).
 */
export function once(
  client: string | undefined,
  exists: (id: string) => Promise<boolean>,
  make: () => Promise<string>,
  find: (intent: Intent) => Promise<{ id: string; found?: boolean } | undefined>,
  data?: () => unknown,
): Promise<Made> {
  if (!client) return make().then((id) => ({ id, replay: false, found: false }));
  const turn = (making.get(client) ?? Promise.resolve())
    .catch(() => {})
    .then(async (): Promise<Made> => {
      const known = ledger.made(client);
      if (known?.key && (await exists(known.key)))
        return { id: known.key, replay: true, data: known.data, found: known.found };
      if (known && !known.key) {
        const hit = await find(known);
        if (hit) {
          ledger.remember(client, hit.id, hit.found);
          return { id: hit.id, replay: true, data: known.data, found: !!hit.found };
        }
      }
      const start = await data?.();
      ledger.intend(client, start);
      try {
        const id = await make();
        ledger.remember(client, id);
        return { id, replay: false, data: start, found: false };
      } catch (e) {
        if (refusedOutright(e)) ledger.forget(client);
        throw e;
      }
    });
  making.set(client, turn);
  void turn.finally(() => making.get(client) === turn && making.delete(client)).catch(() => {});
  return turn;
}
/**
 * Uploads a file to the issue once per `client` (the app's id for the file), so a resend after a lost answer doesn't
 * attach it twice. Jira keeps no properties on attachments, so the intent keeps the issue's attachment ids from before
 * the send: a lost answer is matched to a file this account attached since, of the same name and size, that no other
 * upload owns. Such a match is marked `found`: it may be the user's own file, so cleanup never deletes it.
 */
export async function uploadAttachment(key: string, file: File, client?: string) {
  const attachments = async () =>
    ((await jira(`${at(key)}?fields=attachment`)).fields.attachment ?? []) as any[];
  const ledgerClient = client && `upload:${client}`;
  const made = await once(
    ledgerClient,
    async (id) => (await attachments()).some((a) => String(a.id) === id),
    async () => {
      const body = new FormData();
      body.append("file", file, file.name);
      const [attachment] = await jira(`${at(key)}/attachments`, { method: "POST", body });
      return String(attachment.id);
    },
    async ({ data: before }) => {
      // An older build's intent has no list to tell new files from old ones: upload again rather than guess.
      if (!Array.isArray(before)) return undefined;
      const account = await myself();
      const match = (await attachments())
        .filter(
          (a) =>
            !before.includes(String(a.id)) &&
            !ledger.owned("upload:", String(a.id), ledgerClient!) &&
            a.author?.accountId === account &&
            a.filename === file.name &&
            Number(a.size) === file.size,
        )
        .sort((a, b) => Date.parse(a.created) - Date.parse(b.created))[0];
      return match && { id: String(match.id), found: true };
    },
    async () => (await attachments()).map((a) => String(a.id)),
  );
  return { id: made.id, found: made.found };
}
/** Every comment on the issue, page by page. */
async function allComments(key: string) {
  const comments: any[] = [];
  for (let startAt = 0; ;) {
    const page = await jira<{ comments?: any[]; total?: number }>(
      `${at(key)}/comment?expand=properties&startAt=${startAt}&maxResults=100`,
    );
    comments.push(...(page.comments ?? []));
    startAt += page.comments?.length ?? 0;
    if (!page.comments?.length || startAt >= (page.total ?? 0)) return comments;
  }
}
/** The issue this client's create made, by its tag: every page of the project's issues this user created since the intent. */
async function taggedIssue(project: string, client: string, since: number) {
  const minutes = Math.ceil((Date.now() - since) / 60_000) + 2;
  let nextPageToken: string | undefined;
  do {
    const page = await jira<{ issues?: any[]; nextPageToken?: string }>("/rest/api/3/search/jql", {
      method: "POST",
      body: JSON.stringify({
        jql: `project = "${project}" AND creator = currentUser() AND created >= -${minutes}m`,
        fields: ["summary"],
        properties: [TAG],
        maxResults: 100,
        ...(nextPageToken ? { nextPageToken } : {}),
      }),
    });
    const hit = page.issues?.find((i) => tagged(i.properties, client));
    if (hit) return hit.key as string;
    nextPageToken = page.nextPageToken;
  } while (nextPageToken);
}
/** A field's value as the create payload shapes it, from Jira's copy or from a payload, for comparing the two. */
function comparable(field: string, value: any): unknown {
  // Empty is empty however it's spelt: Jira answers [] for no labels or fix versions, a payload leaves them out.
  if (value === null || value === undefined || (Array.isArray(value) && !value.length))
    return undefined;
  if (field === "description") return value.content?.length ? adfShape(value) : undefined;
  if (field === "priority") return value.name;
  if (field === "assignee") return value.accountId;
  if (field === "parent") return value.key;
  if (field === "fixVersions") return value.map((v: any) => String(v.id)).sort();
  if (field === "labels") return [...value].sort();
  return value;
}
/** A document's structure, text, marks, link URLs and media ids, without the ids and empty values Jira adds or drops. */
function adfShape(node: any): unknown {
  if (Array.isArray(node)) {
    const list = node.map(adfShape).filter((child) => child !== undefined);
    return list.length ? list : undefined;
  }
  if (node === null || typeof node !== "object") return node ?? undefined;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(node).sort()) {
    if (key === "localId" || key === "version" || key.startsWith("__")) continue;
    const value = adfShape(node[key]);
    if (value !== undefined && !(typeof value === "object" && !Object.keys(value as object).length))
      out[key] = value;
  }
  return out;
}
const sameValue = (field: string, a: unknown, b: unknown) =>
  JSON.stringify(comparable(field, a)) === JSON.stringify(comparable(field, b));
/**
 * A replayed create: the first send made the issue, but its answer was lost and the issue was edited since. Sends the
 * fields edited or cleared since that send (`sent`), unless Jira's copy of one changed too: Jira's newer value wins
 * then, as a description edit made from an older text does (DESCRIPTION_CONFLICT).
 */
async function catchUp(key: string, fields: Record<string, unknown>, sent: any) {
  // An older build's intent has no record of what was sent: nothing to tell edits from Jira's values.
  if (!sent) return;
  // A field the create leaves out is empty now: one the send had was cleared since (sync review 3-3).
  const edited = [...new Set([...Object.keys(fields), ...Object.keys(sent)])].filter(
    (field) =>
      !["project", "issuetype"].includes(field) && !sameValue(field, fields[field], sent[field]),
  );
  if (!edited.length) return;
  const current = (await jira(`${at(key)}?fields=${edited.join(",")}`)).fields ?? {};
  const update = Object.fromEntries(
    edited
      .filter((field) => sameValue(field, current[field], sent[field]))
      .map((field) => [field, fields[field] ?? (Array.isArray(sent[field]) ? [] : null)]),
  );
  if (Object.keys(update).length)
    await jira(at(key), { method: "PUT", body: JSON.stringify({ fields: update }) });
  // A description Jira changed (or rewrote past recognising) isn't overwritten, nor is the edit dropped: the editor keeps
  // it beside Jira's and asks which to keep (BJ-20).
  if (edited.includes("description") && !("description" in update))
    throw new UserError(DESCRIPTION_CONFLICT);
}
async function run(ctx: Context, op: Op) {
  const key = ctx.key;
  switch (op.op) {
    case "fields": {
      if (op.fields.project !== undefined)
        throw new UserError("Jira's API cannot move an issue to another project.");
      const { labelEdits, descriptionBase, ...rest } = op.fields,
        fields = fieldPayload(rest);
      // Jira has no conditional update, so compare first: an edit made from an older text must not overwrite someone else's newer one.
      if (descriptionBase !== undefined) {
        const current = (await jira(`${at(key)}?fields=description`)).fields?.description,
          squash = (text: string) => text.replace(/\s+/g, " ").trim();
        if (squash(adfToText(current)) !== squash(descriptionBase))
          throw new UserError(DESCRIPTION_CONFLICT);
      }
      // Single adds and removes, so labels someone else added meanwhile survive.
      const update = labelEdits && {
        labels: [
          ...labelEdits.add.map((add) => ({ add })),
          ...labelEdits.remove.map((remove) => ({ remove })),
        ],
      };
      // Jira refuses a type in another workflow or hierarchy (Subtask ↔ Task); only Jira's Move can do that.
      const refused = (reason: string) =>
        new UserError(
          `Jira won't change ${key} to ${rest.type}: ${reason} Use Move in Jira for this change.`,
        );
      if (Object.keys(fields).length || update?.labels.length)
        await jira(at(key), {
          method: "PUT",
          body: JSON.stringify({ fields, ...(update?.labels.length ? { update } : {}) }),
        }).catch((e) => {
          let reason: string | undefined;
          try {
            if (e instanceof JiraError) reason = JSON.parse(e.body).errors?.issuetype;
          } catch {}
          throw reason ? refused(reason) : e;
        });
      // Jira answers 204 yet keeps the old type for a name it doesn't know.
      if (rest.type) {
        const now = (await jira(`${at(key)}?fields=issuetype`)).fields.issuetype?.name;
        if (now !== rest.type) throw refused(`Jira kept it as ${now}.`);
      }
      return;
    }
    case "status":
      return transition(key, op.status);
    case "watcher": {
      await jira(`${at(key)}/watchers${op.add ? "" : `?accountId=${encodeURIComponent(op.id)}`}`, {
        method: op.add ? "POST" : "DELETE",
        ...(op.add ? { body: JSON.stringify(op.id) } : {}),
      });
      return;
    }
    case "attachment.delete": {
      const issue = await jira(`${at(key)}?fields=attachment`);
      if (!issue.fields.attachment?.some((a: any) => String(a.id) === op.id)) return;
      await jira(`/rest/api/3/attachment/${encodeURIComponent(op.id)}`, { method: "DELETE" });
      return;
    }
    case "attachment.add":
      throw new UserError("Upload the attachment before sending this change.");
    case "rank": {
      await jira("/rest/agile/1.0/issue/rank", {
        method: "PUT",
        body: JSON.stringify({
          issues: [key],
          ...(op.after ? { rankAfterIssue: op.after } : { rankBeforeIssue: op.before }),
        }),
      });
      return;
    }
    case "create": {
      const { project, status, ...rest } = op.fields;
      if (!project) throw new UserError("Choose a project before creating the issue.");
      const fields: Record<string, unknown> = {
        ...fieldPayload(rest),
        project: { key: project },
        issuetype: { name: await typeFor(project, rest.type, rest.parent ?? undefined) },
      };
      // The create sends no empty fields; a replay compares with them, so a clear made since goes to Jira.
      const sent = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null));
      const made = await once(
        op.client,
        (known) => stillThere(`${at(known)}?fields=summary`),
        async () =>
          (
            await jira<{ key: string }>("/rest/api/3/issue", {
              method: "POST",
              body: JSON.stringify({ fields: sent, ...tag(op.client) }),
            })
          ).key,
        async ({ at: since }) => {
          const hit = await taggedIssue(project, op.client!, since);
          if (hit) return { id: hit };
          // Not in search yet: Jira's index may still be behind. Only an intent this old counts as never made.
          if (Date.now() - since < SEARCH_WAIT_MS)
            throw new RetryLater(
              "Jira hasn't confirmed whether an earlier send created this issue yet. It will be sent again shortly.",
            );
        },
        () => sent,
      );
      ctx.created[key] = made.id;
      ctx.key = made.id;
      if (made.replay) {
        ctx.replay = true;
        // A field Jira refuses doesn't keep the job's later steps (status, comments, links) from going.
        await catchUp(made.id, fields, made.data).catch((e) => {
          if (!(e instanceof JiraError && e.status === 400) && !(e instanceof UserError)) throw e;
          ctx.warning = `Jira didn't take the edits made to ${made.id} since it was created: ${e instanceof JiraError ? e.reason : e.message}`;
        });
      }
      if (status)
        await transition(made.id, status).catch((e) => {
          ctx.warning = `Created ${made.id}, but Jira could not move it to the chosen status: ${e instanceof JiraError ? e.reason : e.message}`;
        });
      return;
    }
    case "delete": {
      // Already gone (deleted in Jira, or by an earlier write): nothing left to do.
      const found = await jira(`${at(key)}?fields=subtasks`).catch((e) => {
        if (e instanceof JiraError && e.status === 404) return null;
        throw e;
      });
      if (!found) return;
      const { subtasks = [] } = found.fields;
      await jira(`${at(key)}?deleteSubtasks=true`, { method: "DELETE" });
      for (const subtask of subtasks) ctx.touched.add(subtask.key);
      return;
    }
    case "comment": {
      // Jira's native reply thread. A parent that never reached Jira, or is gone with no replies left, can't hold one: the reply then posts as a comment rather than being lost.
      const post = (parentId?: string) =>
        jira<{ id: string }>(`${at(key)}/comment`, {
          method: "POST",
          body: JSON.stringify({
            body: op.body,
            ...(parentId ? { parentId: Number(parentId) } : {}),
            ...tag(op.client),
          }),
        });
      const parent = op.parentId && /^\d+$/.test(op.parentId) ? op.parentId : undefined;
      // A resend whose first send reached Jira (the tab closed or lost the answer) gets that comment back (sync D1).
      const comment = await once(
        op.client && `comment:${op.client}`,
        (id) => stillThere(`${at(key)}/comment/${encodeURIComponent(id)}`),
        async () =>
          String(
            (
              await post(parent).catch((e) => {
                if (
                  parent &&
                  e instanceof JiraError &&
                  e.status === 400 &&
                  /parent comment/i.test(e.body)
                )
                  return post();
                throw e;
              })
            ).id,
          ),
        async () => {
          const hit = (await allComments(key)).find((c) => tagged(c.properties, op.client!));
          return hit && { id: String(hit.id) };
        },
      );
      ctx.created[op.ref] = comment.id;
      return;
    }
    case "comment.edit": {
      await jira(`${at(key)}/comment/${encodeURIComponent(op.id)}`, {
        method: "PUT",
        body: JSON.stringify({ body: op.body }),
      });
      return;
    }
    case "comment.delete": {
      await jira(`${at(key)}/comment/${encodeURIComponent(op.id)}`, { method: "DELETE" }).catch(
        (e) => {
          if (!(e instanceof JiraError && e.status === 404)) throw e;
        },
      );
      return;
    }
    case "weblink": {
      // Matched by URL, not globalId: a link added in Jira's UI has another globalId, so a resend would duplicate it (R1-D1).
      const title = op.title || op.url,
        links = (await jira<any[]>(`${at(key)}/remotelink`)).filter(
          (l) => l.object?.url === op.url,
        );
      if (op.remove) {
        for (const link of links)
          await jira(`${at(key)}/remotelink/${encodeURIComponent(link.id)}`, {
            method: "DELETE",
          }).catch((e) => {
            if (!(e instanceof JiraError && e.status === 404)) throw e;
          });
        return;
      }
      if (links.some((l) => (l.object.title || l.object.url) === title)) return;
      const [link] = links;
      await jira(`${at(key)}/remotelink${link ? `/${encodeURIComponent(link.id)}` : ""}`, {
        method: link ? "PUT" : "POST",
        body: JSON.stringify(
          link
            ? {
                ...(link.globalId ? { globalId: link.globalId } : {}),
                object: { ...link.object, title },
              }
            : { globalId: op.url, object: { url: op.url, title } },
        ),
      });
      return;
    }
    case "link": {
      const ends = linkEnds(key, op.target, op.kind);
      ctx.touched.add(op.target);
      // A remove reads the issue's links alongside the link type, not after it (R2-issue-fields-D13).
      const read = op.remove ? jira(`${at(key)}?fields=issuelinks`) : undefined;
      read?.catch(() => {});
      const type = await linkType(op.kind);
      if (!op.remove) {
        // A resent job (an earlier send's answer was lost) or a replayed create may have linked it already.
        if (ctx.replay) {
          const links = (await jira(`${at(key)}?fields=issuelinks`)).fields.issuelinks as any[];
          if (
            links?.some(
              (l) =>
                l.type.name === type.name && (l.outwardIssue ?? l.inwardIssue)?.key === op.target,
            )
          )
            return;
        }
        await jira("/rest/api/3/issueLink", {
          method: "POST",
          body: JSON.stringify({
            type: { name: type.name },
            outwardIssue: { key: ends.inward },
            inwardIssue: { key: ends.outward },
          }),
        });
        return;
      }
      const links = (await read!).fields.issuelinks as any[];
      const outwardFromKey = ends.outward === key;
      const link =
        links.find(
          (l) =>
            l.type.name === type.name &&
            (outwardFromKey ? l.outwardIssue?.key === op.target : l.inwardIssue?.key === op.target),
        ) ??
        links.find(
          (l) => l.type.name === type.name && (l.outwardIssue ?? l.inwardIssue)?.key === op.target,
        );
      if (link)
        await jira(`/rest/api/3/issueLink/${encodeURIComponent(link.id)}`, { method: "DELETE" });
      return;
    }
    default:
      throw new UserError(
        `BetterJira does not know how to send "${(op as { op?: string }).op}" to Jira.`,
      );
  }
}

/**
 * Applies a client's ops in order, then returns Jira's fresh copy of the issue (and of linked issues) either way.
 * `settle: false` skips re-reading the issue itself, for a client that has a later write for it queued (R2-create-D2).
 */
/** What a write did; `retry`: send the same ops again later (an earlier send's outcome can't be told yet). */
export type Written = {
  error?: string;
  retry?: boolean;
  key: string;
  created: Record<string, string>;
  others: any[];
  issue?: any;
  full?: any;
};
export async function applyOps(
  key: string,
  ops: Op[],
  board?: number,
  settle = true,
  resend = false,
): Promise<Written> {
  const ctx: Context = { key, created: {}, touched: new Set(), replay: resend };
  let error: string | undefined;
  // A later op in this job may name a comment an earlier op just created.
  const independent = (op?: Op) => op?.op === "link" || op?.op === "weblink";
  try {
    for (let i = 0; i < ops.length;) {
      // A run of links doesn't depend on itself: send it at once (R1-D101).
      let end = i + 1;
      if (independent(ops[i])) while (independent(ops[end])) end++;
      const comments = new Map(Object.entries(ctx.created).filter(([from]) => from !== key));
      const results = await Promise.allSettled(
        ops.slice(i, end).map((op) => run(ctx, renameCommentIds(op, comments))),
      );
      const failed = results.find((r) => r.status === "rejected");
      if (failed) throw failed.reason;
      i = end;
    }
  } catch (e) {
    // Anything short of a definite refusal (a lost answer, a 5xx, a timeout) may have reached Jira: the same job, with the
    // same client ids, is sent again and reconciled, never dropped and resubmitted as new (sync review 3-1).
    if (!refusedOutright(e)) {
      console.error("[write]", ctx.key, String(e).slice(0, 300));
      return {
        error:
          e instanceof RetryLater
            ? e.message
            : "Jira didn't answer. The change will be sent again shortly.",
        retry: true,
        key,
        created: {},
        others: [],
      };
    }
    error = e instanceof JiraError ? e.reason : (e as UserError).message;
  }
  error ??= ctx.warning;
  const [fresh, ...touched] = await Promise.all([
    settle ? refresh(ctx.key, board).catch(() => undefined) : undefined,
    ...[...ctx.touched].map((other) => refresh(other).catch(() => undefined)),
  ]);
  const others = touched.flatMap((r) => (r ? [r.issue] : []));
  return {
    error,
    key: ctx.key,
    created: ctx.created,
    others,
    ...(fresh === undefined ? {} : { issue: fresh?.issue ?? null, full: fresh?.full ?? null }),
  };
}
