import { jira, JiraError } from "./jira";
import { createdIssue, ESTIMATES, refresh, rememberCreated } from "./mirror";
import { renameCommentIds, type Op } from "./jira-ops";
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
  /** The create was a replay of one Jira already took: the rest of the job went with the first send. */
  replay?: boolean;
};
// ponytail: one create at a time server-wide, so two sends of one submit never race; per-client locks if creates ever queue.
let creating: Promise<unknown> = Promise.resolve();
/** Jira's create has no idempotency key, so the issue made for `client` is kept, and a replay gets it back while it exists (R2-create-D1). */
function createOnce(client: string | undefined, create: () => Promise<string>) {
  const turn = creating.then(async () => {
    const known = client && createdIssue(client);
    if (known) {
      const there = await jira(`${at(known)}?fields=summary`).then(
        () => true,
        (e) => {
          if (e instanceof JiraError && e.status === 404) return false;
          throw e;
        },
      );
      if (there) return { key: known, replay: true };
    }
    const key = await create();
    if (client) rememberCreated(client, key);
    return { key, replay: false };
  });
  creating = turn.catch(() => {});
  return turn;
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
          throw new UserError(
            "Someone changed the description in Jira while you were editing it. Pick a version in the description.",
          );
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
      for (const name of Object.keys(fields)) if (fields[name] === null) delete fields[name];
      const created = await createOnce(
        op.client,
        async () =>
          (
            await jira<{ key: string }>("/rest/api/3/issue", {
              method: "POST",
              body: JSON.stringify({ fields }),
            })
          ).key,
      );
      ctx.created[key] = created.key;
      ctx.key = created.key;
      if (created.replay) {
        ctx.replay = true;
        return;
      }
      if (status)
        await transition(created.key, status).catch((e) => {
          ctx.warning = `Created ${created.key}, but Jira could not move it to the chosen status: ${e instanceof JiraError ? e.reason : e.message}`;
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
          }),
        });
      const parent = op.parentId && /^\d+$/.test(op.parentId) ? op.parentId : undefined;
      const comment = await post(parent).catch((e) => {
        if (parent && e instanceof JiraError && e.status === 400 && /parent comment/i.test(e.body))
          return post();
        throw e;
      });
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
      const type = await linkType(op.kind),
        ends = linkEnds(key, op.target, op.kind);
      ctx.touched.add(op.target);
      if (!op.remove) {
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
      const links = (await jira(`${at(key)}?fields=issuelinks`)).fields.issuelinks as any[];
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
export async function applyOps(key: string, ops: Op[], board?: number, settle = true) {
  const ctx: Context = { key, created: {}, touched: new Set() };
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
      if (ctx.replay) break;
      i = end;
    }
  } catch (e) {
    error =
      e instanceof JiraError
        ? e.reason
        : e instanceof UserError
          ? e.message
          : "Could not reach Jira.";
    if (!(e instanceof UserError)) console.error("[write]", ctx.key, String(e).slice(0, 300));
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
