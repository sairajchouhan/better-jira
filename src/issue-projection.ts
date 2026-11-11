import { jiraAvatar } from "./avatar-url";
import { issueAttachments } from "./attachment-media";
import { pullRequestCount } from "./issue-properties";

/** Pure: raw Jira records in, the app's issue and property shapes out. No I/O. */

/** A Jira account as the app shows it. */
export const jiraUser = (u: any) => ({
  id: u.accountId,
  name: u.displayName,
  avatar: jiraAvatar(u.avatarUrls),
});

/** Jira's `/watchers` answer; the list is incomplete when Jira's permissions hide some watchers. */
export function watcherList(w: { watchers?: any[]; watchCount?: number }) {
  const watchers = (w.watchers ?? []).map(jiraUser);
  return { watchers, watchersComplete: watchers.length === w.watchCount };
}

/** Jira's `/remotelink` answer: the web links' URLs. */
export const remoteLinkUrls = (links: any[]): string[] =>
  links.flatMap((l) => (l.object?.url ? [l.object.url] : []));

/**
 * The projection for one Jira site. Custom field IDs differ per site, so rank and story points are found in the site's
 * `/rest/api/3/field` list by type and name; without that list (Jira unreachable) Jira Cloud's usual IDs stand in.
 */
export function issueProjection(siteFields: any[] | null) {
  const rank: string =
    siteFields?.find((f) => f.schema?.custom === "com.pyxis.greenhopper.jira:gh-lexo-rank")?.id ??
    "customfield_10022";
  const estimates: string[] = siteFields
    ? siteFields
        .filter((f) => /^story points?( estimate)?$/i.test(f.name))
        .sort((a, b) => a.name.length - b.name.length)
        .map((f) => f.id)
    : ["customfield_10023", "customfield_10016"];
  return {
    /** Story point field IDs, the preferred one first. */
    estimates,
    /** Jira's `fields=` list for every issue read the mirror stores: what `slim` reads, plus the detail's description and comments. */
    fields: [
      "summary,status,issuetype,priority,assignee,reporter,creator,created,updated,resolutiondate,statuscategorychangedate,duedate,project,issuelinks,labels,parent,description,comment,fixVersions,watches,attachment,customfield_10000",
      rank,
      ...estimates,
    ].join(","),
    /** What the board and search need for every issue; description and comments stay in the raw record. */
    slim(i: any, board: number) {
      const f = i.fields;
      const text = (n: any): string =>
        typeof n === "string" ? n : [n?.text ?? "", ...(n?.content ?? []).map(text)].join(" ");
      const links = new Set<string>();
      const collectLinks = (n: any) => {
        for (const m of n?.marks ?? [])
          if (m.type === "link" && m.attrs?.href) links.add(m.attrs.href);
        if (n?.type === "inlineCard" && n.attrs?.url) links.add(n.attrs.url);
        for (const child of n?.content ?? []) collectLinks(child);
      };
      collectLinks(f.description);
      for (const url of text(f.description).match(/https?:\/\/[^\s<>"\]|)]+/g) ?? [])
        links.add(url);
      const creator = f.creator ?? f.reporter;
      return {
        key: i.key,
        board,
        summary: f.summary,
        status: f.status.id,
        type: f.issuetype?.name,
        typeIcon: f.issuetype?.iconUrl,
        priority: f.priority?.name,
        assignee: f.assignee && jiraUser(f.assignee),
        labels: f.labels,
        attachments: issueAttachments(i),
        parent: f.parent?.key,
        rank: f[rank],
        comments: f.comment?.total ?? 0,
        updated: f.updated,
        // Workflows that set no resolution leave resolutiondate empty; entering Done is the completion time then.
        resolved:
          f.resolutiondate ??
          (f.status?.statusCategory?.key === "done" ? f.statuscategorychangedate : null) ??
          null,
        created: f.created,
        creator: creator ? jiraUser(creator) : null,
        due: f.duedate ?? null,
        watching: f.watches?.isWatching === true,
        project: f.project
          ? { key: f.project.key, name: f.project.name }
          : { key: i.key.split("-")[0], name: i.key.split("-")[0] },
        description: text(f.description),
        milestones: f.fixVersions?.map((v: any) => ({ id: v.id, name: v.name })),
        prCount: pullRequestCount(f.customfield_10000),
        estimate: estimates.map((id) => f[id]).find((v) => typeof v === "number"),
        links: [...links],
        relations: (f.issuelinks ?? [])
          .map((r: any) => ({
            key: (r.outwardIssue ?? r.inwardIssue)?.key,
            kind: /block/i.test(r.type?.name ?? "")
              ? r.outwardIssue
                ? "blocking"
                : "blocked"
              : /duplicat/i.test(r.type?.name ?? "")
                ? r.outwardIssue
                  ? "duplicate"
                  : "duplicated"
                : "related",
          }))
          .filter((r: any) => r.key),
      };
    },
  };
}
export type IssueProjection = ReturnType<typeof issueProjection>;
/** Bump when `slim`'s output changes: the mirror re-projects every stored issue on its next start. */
export const SLIM_VERSION = "6";

/** A mirrored issue with what enrichment stored for it (null until enriched). */
export type PropertyRow = {
  key: string;
  slim: string;
  data: string | null;
  source_updated: string | null;
};

/**
 * Each issue's properties for `/api/properties`: the whole slim row (so edits made directly in Jira reach open clients),
 * its project's lead, and what enrichment stored, when that was stored for the issue's current revision.
 * `pending` is how many issues the enrichment still has queued.
 */
export function propertyEntries(
  rows: PropertyRow[],
  projectInfo: (key: string) => { lead?: unknown } | null,
  pending: number,
) {
  let missing = 0,
    errors = 0;
  const projects = new Map<string, { lead?: unknown } | null>();
  const entries = Object.fromEntries(
    rows.map((r) => {
      const slim = JSON.parse(r.slim);
      const projectKey = slim.project?.key;
      if (projectKey && !projects.has(projectKey)) projects.set(projectKey, projectInfo(projectKey));
      const fresh = r.source_updated === slim.updated;
      if (!fresh) missing++;
      const data = fresh && r.data ? JSON.parse(r.data) : {};
      if (data.errors?.length) errors++;
      const { remoteLinks = [], ...extra } = data;
      return [
        r.key,
        {
          ...slim,
          projectLead: projects.get(projectKey)?.lead,
          ...extra,
          links: [...new Set([...(slim.links ?? []), ...remoteLinks])],
        },
      ];
    }),
  );
  return {
    progress: {
      total: rows.length,
      pending: Math.max(pending, missing),
      completed: rows.length - missing,
      errors,
    },
    entries,
  };
}
