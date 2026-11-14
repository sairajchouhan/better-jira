/** Jira issue links in Linear's relation model (BJ-15). Pure; shared by the projection, the writes and the client. */

/** What a link row needs of an issue the mirror may not hold: Jira sends it inside `issuelinks`, so no extra read. */
export type LinkedIssue = { summary: string; status?: { name: string; category: string } };
/**
 * One side of a Jira issue link. `kind` is one of Linear's (`blocked`, `blocking`, `related`, `duplicate`, `duplicated`) or,
 * for a Jira link type Linear has no equivalent for, `inward:<type name>` / `outward:<type name>` with Jira's phrase for
 * this side as `label` ("is caused by", "clones").
 */
export type Relation = { key: string; kind: string; label?: string; issue?: LinkedIssue };

/** The other issue's kind, as relate() stores it on that issue; the other issue's role in Linear's Remove menu (RAJ-52). */
export const RELATION_ISSUE: Record<string, string> = {
  blocked: "blocking",
  blocking: "blocked",
  related: "related",
  duplicate: "duplicated",
  duplicated: "duplicate",
};
/** Linear's relation kinds by name, in its Change to… order (startup-root `gFn`, labels from `vFn`). */
export const LINEAR_RELATIONS = [
  ["blocked", "Blocked by"],
  ["blocking", "Blocking"],
  ["duplicate", "Duplicate of"],
  ["duplicated", "Duplicated by"],
  ["related", "Related"],
] as const;
/** Linear's sidebar sections, in its order (IssueDetailsPaneSidebar `J_`): "Duplicates" lists the issues duplicating this one. */
export const LINEAR_SECTIONS = [
  ["duplicate", "Duplicate of"],
  ["blocked", "Blocked by"],
  ["blocking", "Blocking"],
  ["related", "Related"],
  ["duplicated", "Duplicates"],
] as const;

/** The Jira link type each Linear kind is written as; the same patterns pick the type for a write. */
export const LINEAR_TYPES = [
  { pattern: /block/i, outward: "blocking", inward: "blocked" },
  { pattern: /duplicat/i, outward: "duplicate", inward: "duplicated" },
  { pattern: /relat/i, outward: "related", inward: "related" },
] as const;

const JIRA_KIND = /^(inward|outward):(.+)$/;
/** The Jira link type a relation kind outside Linear's model names, or null for Linear's kinds. */
export const jiraLinkType = (kind: string) => JIRA_KIND.exec(kind)?.[2] ?? null;
/** This issue is the link's inward end (Jira shows it the inward phrase: "is blocked by", "is caused by"). */
export const inwardKind = (kind: string) =>
  kind === "blocked" || kind === "duplicated" || kind.startsWith("inward:");
/** This issue is the link's outward end ("blocks", "causes"); Relates has no ends. */
export const outwardKind = (kind: string) =>
  kind === "blocking" || kind === "duplicate" || kind.startsWith("outward:");
/** The kind the other issue holds for the same link. */
export const inverseKind = (kind: string) => {
  const jira = JIRA_KIND.exec(kind);
  return jira ? `${jira[1] === "inward" ? "outward" : "inward"}:${jira[2]}` : (RELATION_ISSUE[kind] ?? kind);
};

/** A section heading or row name: Linear's, or Jira's phrase in sentence case ("Is caused by"). */
export function relationName(relation: Pick<Relation, "kind" | "label">) {
  const linear = LINEAR_SECTIONS.find(([kind]) => kind === relation.kind)?.[1];
  if (linear) return linear;
  const phrase = relation.label || jiraLinkType(relation.kind) || relation.kind;
  return phrase[0]!.toUpperCase() + phrase.slice(1);
}

/** One entry of Jira's `issuelinks`, seen from the issue that holds it; null for a link to an issue the account can't see. */
export function linkRelation(link: any): Relation | null {
  const other = link?.outwardIssue ?? link?.inwardIssue;
  if (!other?.key) return null;
  const outward = !!link.outwardIssue,
    type = link.type ?? {},
    name: string = type.name ?? "";
  const fields = other.fields;
  const issue: LinkedIssue | undefined =
    typeof fields?.summary === "string"
      ? {
          summary: fields.summary,
          ...(fields.status?.name
            ? { status: { name: fields.status.name, category: fields.status.statusCategory?.key ?? "new" } }
            : {}),
        }
      : undefined;
  const linear = name ? LINEAR_TYPES.find((t) => t.pattern.test(name)) : LINEAR_TYPES[2];
  return {
    key: other.key,
    ...(linear
      ? { kind: outward ? linear.outward : linear.inward }
      : {
          kind: `${outward ? "outward" : "inward"}:${name}`,
          label: (outward ? type.outward : type.inward) || name,
        }),
    ...(issue ? { issue } : {}),
  };
}

/** The sidebar's sections: Linear's that have rows, in its order, then each other Jira link kind in the order Jira lists it. */
export function relationSections(relations: readonly Relation[]) {
  const sections: { kind: string; heading: string; rows: Relation[] }[] = LINEAR_SECTIONS.map(
    ([kind, heading]) => ({ kind, heading, rows: relations.filter((r) => r.kind === kind) }),
  );
  for (const r of relations)
    if (jiraLinkType(r.kind) && !sections.some((s) => s.kind === r.kind))
      sections.push({
        kind: r.kind,
        heading: relationName(r),
        rows: relations.filter((x) => x.kind === r.kind),
      });
  return sections.filter((s) => s.rows.length);
}

/** Linear's mark-as pickers (startup-root `gJ` + `disableWithReason`): the issues a new `kind` link would repeat, any
 *  direction of the same link type, with the reason each is disabled. Other kinds disable nothing (R3-relations-D6). */
const ALREADY: Record<string, [kinds: string[], reason: string]> = {
  blocked: [["blocked", "blocking"], "Already blocked by this issue"],
  blocking: [["blocked", "blocking"], "Already blocking this issue"],
  duplicate: [["duplicate", "duplicated"], "Already duplicated"],
  related: [["related"], "Already referenced"],
};
export function alreadyLinked(relations: readonly Relation[] | undefined, kind: string): Map<string, string> {
  const rule = ALREADY[kind];
  if (!rule) return new Map();
  const [kinds, reason] = rule;
  return new Map((relations ?? []).filter((r) => kinds.includes(r.kind)).map((r) => [r.key, reason]));
}
