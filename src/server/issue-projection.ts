import { issueAttachments } from "@/shared/attachment-media";
import { pullRequestSummary } from "@/shared/issue-properties";
import { linkRelation } from "@/shared/relations";
import { smartLink } from "@/shared/smart-link";
import { jiraUser } from "@/shared/person-name";
import type { SlimField } from "@/shared/issue-model";

/** Pure: raw Jira records in, the app's issue and property shapes out. No I/O. */

/** A Jira account as the app shows it (shared with the client, so a nameless account renders the same everywhere). */
export { jiraUser };

/** Jira's `/watchers` answer; the list is incomplete when Jira's permissions hide some watchers. */
export function watcherList(w: { watchers?: any[]; watchCount?: number }) {
  const watchers = (w.watchers ?? []).map(jiraUser);
  return { watchers, watchersComplete: watchers.length === w.watchCount };
}

/** Jira's `/remotelink` answer as the property cache keeps it: the web links' URLs, and the title Jira gives each one where it
 *  is more than the URL, which the card's link badge and hover card show (Linear's link card `gt` titles a link by its title). */
export function remoteLinkData(links: any[]): RemoteLinks {
  const linked = links.filter((l) => typeof l.object?.url === "string");
  return {
    remoteLinks: linked.map((l) => l.object.url),
    linkTitles: Object.fromEntries(
      linked.flatMap((l) => (l.object.title?.trim() && l.object.title !== l.object.url ? [[l.object.url, l.object.title]] : [])),
    ),
  };
}
export type RemoteLinks = { remoteLinks: string[]; linkTitles: Record<string, string> };

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
    /** What the board and search need for every issue; the rich description and comments stay in the raw record. Which boards
     *  hold it is the mirror's to say (issue-store.ts), not the record's. */
    slim(i: any) {
      const f = i.fields;
      const text = (n: any): string =>
        typeof n === "string" ? n : [n?.text ?? "", ...(n?.content ?? []).map(text)].join(" ");
      const links = new Set<string>();
      // A link to a Jira issue is a mention of it, not a resource: Linear lists none for one (#18).
      const link = (url: string) => {
        if (smartLink(url)?.kind !== "issue") links.add(url);
      };
      const collectLinks = (n: any) => {
        for (const m of n?.marks ?? []) if (m.type === "link" && m.attrs?.href) link(m.attrs.href);
        if (n?.type === "inlineCard" && n.attrs?.url) link(n.attrs.url);
        for (const child of n?.content ?? []) collectLinks(child);
      };
      collectLinks(f.description);
      for (const url of text(f.description).match(/https?:\/\/[^\s<>"\]|)]+/g) ?? []) link(url);
      const creator = f.creator ?? f.reporter;
      const prs = pullRequestSummary(f.customfield_10000);
      return {
        key: i.key,
        summary: f.summary,
        status: f.status.id,
        type: f.issuetype?.name,
        typeIcon: f.issuetype?.iconUrl,
        priority: f.priority?.name,
        assignee: f.assignee && jiraUser(f.assignee),
        labels: f.labels,
        attachments: issueAttachments(i),
        parent: f.parent?.key,
        level: f.issuetype?.hierarchyLevel,
        parentLevel: f.parent?.fields?.issuetype?.hierarchyLevel,
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
        /** Every comment's text, for search only (BJ-27); absent without comments. */
        commentText: (f.comment?.comments ?? []).map((c: any) => text(c.body)).join("\n").trim() || undefined,
        milestones: f.fixVersions?.map((v: any) => ({ id: v.id, name: v.name })),
        prCount: prs?.count,
        prStatus: prs?.status,
        estimate: estimates.map((id) => f[id]).find((v) => typeof v === "number"),
        links: [...links],
        relations: (f.issuelinks ?? []).flatMap((link: any) => linkRelation(link) ?? []),
        // Exactly the mirrored fields: a tab clears one a row leaves out (shared/issue-model.ts `MIRRORED_ISSUE_FIELDS`, BJ-394).
      } satisfies Record<SlimField, unknown>;
    },
  };
}
export type IssueProjection = ReturnType<typeof issueProjection>;
/** Bump when `slim`'s output changes: the mirror re-projects every stored issue on its next start. */
export const SLIM_VERSION = "13";

/** A mirrored issue with what enrichment stored for it (null until enriched). */
export type PropertyRow = {
  key: string;
  slim: string;
  data: string | null;
  source_updated: string | null;
};

/**
 * Each issue's properties for `/api/properties`: the whole slim row (so edits made directly in Jira reach open clients),
 * and what enrichment stored, when that was stored for the issue's current revision.
 * `pending` is how many issues the enrichment still has queued.
 */
export function propertyEntries(rows: PropertyRow[], pending: number) {
  let missing = 0,
    errors = 0;
  const entries = Object.fromEntries(
    rows.map((r) => {
      const slim = JSON.parse(r.slim);
      const fresh = r.source_updated === slim.updated;
      if (!fresh) missing++;
      const data = fresh && r.data ? JSON.parse(r.data) : {};
      if (data.errors?.length) errors++;
      const { remoteLinks = [], ...extra } = data;
      return [
        r.key,
        {
          ...slim,
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
