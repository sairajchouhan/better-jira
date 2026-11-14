import { IssueHoverCard } from "./issue-hover-card";
/**
 * One property row's words and icon, in Linear's wording (its issue-history chunk `IssueCommentsAndHistory`, read 2026-11-12):
 * the entry builders `ws` (status), `Es` (priority), `Os` (assignee), `ks` (title), `As`/`js` (labels), `tc` (estimate),
 * `ic` (due date), `Us` (parent), `Ws` (team), `Js` (cycle), `Qs` (project), `ec` (milestone) and `Hs` (relations).
 * Jira-only kinds (resolution, component, files, custom fields) read plainly in the same pattern: "changed Fix version from A to B".
 */
import { absoluteDate, fullTime, activityTime } from "./issue-dates";
import { DescriptionHistoryLink } from "./description-history";
import { useState, type HTMLAttributes, type ReactNode } from "react";
import type { RunPlace, TimelineEvent } from "@/client/features/comments/comment-threads";
import { collapseLabel, partition, type SummaryItem } from "./activity-collapse";
import { statusById, statuses } from "@/shared/board-catalog";
import { Avatar } from "@/client/components/avatar";
import { Icon, type IconName, PriorityIcon, RelationIcon, StatusIcon, TypeDot, hue } from "@/client/components/icons";
import { AppLink } from "@/client/features/navigation/app-link";
import { LinkIcon } from "@/client/components/link-icon";
import { faviconSrc } from "@/shared/smart-link";
import { linkTitle } from "@/shared/issue-resource";
import { boardOf, get } from "@/client/state/store";
import type { Issue, User } from "@/shared/issue-model";
import { LINEAR_RELATIONS, jiraLinkType } from "@/shared/relations";
import { labelDelta, type ActivityRow, type PropertyActivity, type Relation } from "./issue-activity";
import type { FieldValue, NamedValue } from "./jira-history";

const related = (target: Issue) => ({ board: target.board, selected: target.key, panel: true, view: get().view });

const name = (value: unknown) =>
  value && typeof value === "object" && "name" in value ? String((value as { name: unknown }).name) : String(value);
const idOf = (value: unknown) =>
  value && typeof value === "object" && "id" in value ? (value as { id: unknown }).id : value;
/** Linear's `formatAbsoluteDate`: "Nov 7", "Nov 7, 2025" in another year. */
const day = (value: unknown) => absoluteDate(String(value));
/** lodash `truncate(text, { length, omission: "…" })`, as Linear's TitleChangeTooltipContent cuts the new title: the omission
 *  counts toward the length. */
export const truncate = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);
const B = ({ children, title }: { children: ReactNode; title?: string }) => (
  <b className="font-medium" title={title} data-tip={title ? "above" : undefined}>
    {children}
  </b>
);

/** Linear's priority order (`et`): 1 urgent … 4 low, 0 none. Jira's names collapse onto it like `PriorityIcon`. */
export const priorityRank = (priority: unknown) => {
  const p = typeof priority === "string" ? priority : "";
  if (!p || /^no priority$/i.test(p)) return 0;
  if (/highest|urgent|critical|showstopper|blocker/i.test(p)) return 1;
  if (/high|major/i.test(p)) return 2;
  if (/medium|normal/i.test(p)) return 3;
  return 4;
};

/** Linear's relation wording (`Hs`). Jira link types Linear has no relation for keep their own phrase ("clones"). */
const RELATION_ADDED: Record<string, string> = {
  related: "added related issue",
  blocked: "marked this issue as blocked by",
  blocking: "marked this issue as blocking",
  duplicate: "marked this issue as a duplicate of",
  duplicated: "marked this issue as duplicated by",
};
const RELATION_REMOVED: Record<string, string> = {
  related: "removed related issue",
  blocked: "unmarked this issue as being blocked by",
  blocking: "unmarked this issue as blocking",
  duplicate: "unmarked this issue as a duplicate of",
  duplicated: "unmarked this issue as duplicated by",
};

function RelationTarget({ relation }: { relation: Relation }) {
  const target = get().issues.get(relation.key);
  return <IssueHoverCard relation={relation} issue={target} placement="left">{target ? (
    <AppLink to={related(target)} className="hover:text-fg">
      <b className="font-medium">{relation.key}</b> {target.summary}
    </AppLink>
  ) : (
    <>
      <b className="font-medium">{relation.key}</b>
      {relation.issue && ` ${relation.issue.summary}`}
    </>
  )}</IssueHoverCard>;
}

/** Linear's link entry (`ds`): the link's source icon, then its title, which opens the link. One control for a link
 *  added here and one from Jira's history; both take the title the issue's Resources row shows. */
export function LinkedTarget({ title, url }: { title: string; url?: string }) {
  const origin = url && URL.canParse(url) ? new URL(url).origin : undefined;
  return (
    <>
      <span className="inline-flex align-[-2px]">
        <LinkIcon src={origin && faviconSrc(origin)} size={14} className="rounded-[3px]" />
      </span>{" "}
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="font-medium">
          {title}
        </a>
      ) : (
        <B>{title}</B>
      )}
    </>
  );
}

/** A Jira web link as the issue's matching link resource shows it, else by Jira's title (a URL when it has none). */
function JiraLink({ link, issue }: { link: NamedValue; issue: Issue }) {
  const resource = issue.resources?.find((r) => r.kind === "link" && (r.title === link.name || r.url === link.name));
  if (resource) return <LinkedTarget title={linkTitle(resource)} url={resource.url} />;
  return <LinkedTarget title={link.name} url={URL.canParse(link.name) ? link.name : undefined} />;
}

/** A Jira-only single value, worded like Linear's team and due date entries. */
const plain = (label: string, before: ReactNode, after: ReactNode) =>
  after === null ? (
    <>removed {label}</>
  ) : before === null ? (
    <>
      set {label} to <B>{after}</B>
    </>
  ) : (
    <>
      changed {label} from <B>{before}</B> to <B>{after}</B>
    </>
  );

/** Linear's wording for one change. `then` is the shorter form after ", then": "set to Medium", "moved to Done". */
export function describeActivity(event: PropertyActivity, issue: Issue, then = false): ReactNode {
  const { field, before, after, actor } = event;
  const status = (value: unknown) => statusById(boardOf(issue.key), idOf(value))?.name ?? name(value);
  switch (field) {
    case "relation": {
      const relation = (after ?? before) as Relation;
      // A Jira link kind Linear has no wording for is named by Jira's phrase ("removed is caused by link").
      const phrase = jiraLinkType(relation.kind) && (relation.label ?? jiraLinkType(relation.kind));
      const verb = phrase
        ? `${after ? "added" : "removed"} ${phrase} link`
        : after
          ? (RELATION_ADDED[relation.kind] ?? `linked this issue: ${relation.kind}`)
          : (RELATION_REMOVED[relation.kind] ?? `removed link: ${relation.kind}`);
      return (
        <>
          {verb} <RelationTarget relation={relation} />
        </>
      );
    }
    case "status": {
      const words = then || before === null ? `moved to ${status(after)}` : `moved from ${status(before)} to ${status(after)}`;
      return <>{words}<Resolution value={after} /></>;
    }
    case "labels":
      return <LabelChange before={before as string[] | null} after={after as string[] | null} />;
    case "priority": {
      if (then) return after === null ? "removed priority" : `set to ${after}`;
      const from = priorityRank(before),
        to = priorityRank(after);
      if (to === 0) return "removed priority";
      if (from === 0) return `set priority to ${after}`;
      return `${from < to ? "lowered" : "raised"} priority from ${before} to ${after}`;
    }
    case "assignee": {
      // Linear's `Os` drops who had it ("re-assigned to X", "removed assignee"); Jira shows it, so it is named the way Linear
      // names the old value elsewhere: "from X" (priority, team), "removed … X" (parent, team), "Previously:" (title).
      if (after === null)
        return before === null ? "removed assignee" : <>removed assignee <B>{name(before)}</B></>;
      if (idOf(after) === actor.id)
        return before === null || then ? "self-assigned the issue" : <>self-assigned the issue (previously <B>{name(before)}</B>)</>;
      if (then || before === null) return <>assigned to <B>{name(after)}</B></>;
      return <>re-assigned from <B>{name(before)}</B> to <B>{name(after)}</B></>;
    }
    case "due":
      if (after === null) return "removed due date";
      if (then) return `set to ${day(after)}`;
      return before === null
        ? `set the due date to ${day(after)}`
        : `changed the due date from ${day(before)} to ${day(after)}`;
    case "parent":
      if (after === null)
        return (
          <>
            removed parent <B>{name(before)}</B>
          </>
        );
      return before === null ? (
        <>
          set parent to <B>{name(after)}</B>
        </>
      ) : (
        <>
          changed parent issue from <B>{name(before)}</B> to <B>{name(after)}</B>
        </>
      );
    case "title": {
      const title = String(after ?? "");
      // TitleChangeTooltipContent: the new title, cut by lodash `truncate` at 70 with "…", the old one on hover.
      return (
        <>
          changed title to <B title={`Previously: ${before ?? ""}`}>{truncate(title, 70)}</B>
        </>
      );
    }
    case "estimate": {
      if (after === null) return "removed estimate";
      if (before === null)
        return (
          <>
            estimated complexity as <B>{String(after)}</B>
          </>
        );
      return (
        <>
          {Number(before) < Number(after) ? "increased" : "lowered"} estimate from <B>{String(before)}</B> to{" "}
          <B>{String(after)}</B>
        </>
      );
    }
    case "project":
      if (after === null)
        return (
          <>
            removed from project <B>{name(before)}</B>
          </>
        );
      return before === null ? (
        <>
          added to project <B>{name(after)}</B>
        </>
      ) : (
        <>
          changed project from <B title={(before as NamedValue)?.key}>{name(before)}</B>
          <IssueKey value={before} /> to <B title={(after as NamedValue)?.key}>{name(after)}</B>
          <IssueKey value={after} />
        </>
      );
    case "cycle": {
      // `Js` with `appendWord: "cycle"`; Jira's sprints already say "Sprint".
      const cycle = (value: unknown) => {
        const text = name(value);
        return /cycle|sprint/i.test(text) ? <B>{text}</B> : <><B>{text}</B> cycle</>;
      };
      // Jira lists every sprint an unfinished issue rolled through; only the change is news. Sprints match by id, as names change.
      const was = (before as NamedValue[] | null) ?? [],
        now = (after as NamedValue[] | null) ?? [],
        added = now.filter((s) => !was.some((w) => w.id === s.id)),
        removed = was.filter((s) => !now.some((n) => n.id === s.id));
      const names = (list: NamedValue[]) => list.map((s) => s.name).join(", ");
      if (!added.length) return <>removed issue from {cycle(names(removed))}</>;
      return removed.length ? <>moved issue to {cycle(names(added))}</> : <>added issue to {cycle(names(added))}</>;
    }
    case "team":
      if (after === null)
        return (
          <>
            removed team <B>{name(before)}</B>
          </>
        );
      return before === null ? (
        <>
          changed team to <B>{name(after)}</B>
        </>
      ) : (
        <>
          changed team from <B>{name(before)}</B> to <B>{name(after)}</B>
        </>
      );
    case "milestone":
      // The app's Milestone is Jira's Fix version; the name says so on hover for a Jira reader.
      return after === null ? (
        <>
          removed from milestone <B title="Jira Fix version">{name(before)}</B>
        </>
      ) : (
        <>
          added to milestone <B title="Jira Fix version">{name(after)}</B>
        </>
      );
    case "weblink":
      // Removals never reach here: Linear has no entry for them (`withoutRemovedLinks`).
      return (
        <>
          linked <JiraLink link={after as NamedValue} issue={issue} />
        </>
      );
    case "attachment":
      return after === null ? (
        <>
          removed attachment <B>{name(before)}</B>
        </>
      ) : (
        <>
          attached <B>{name(after)}</B>
        </>
      );
    case "component":
      return after === null ? (
        <>
          removed component <B>{name(before)}</B>
        </>
      ) : (
        <>
          added component <B>{name(after)}</B>
        </>
      );
    case "description":
      return <DescriptionHistoryLink versionId={event.id}>updated the description</DescriptionHistoryLink>;
    case "flag":
      return after === null ? "removed the flag" : "flagged the issue";
    case "type":
      return then && after !== null ? `set to ${after}` : plain("issue type", before as string | null, after as string | null);
    case "resolution":
      return plain("resolution", before as string | null, after as string | null);
    case "field": {
      const value = (after ?? before) as FieldValue;
      if (value.name === "environment" && !(before as FieldValue | null)?.value && !(after as FieldValue | null)?.value) return "updated the environment";
      const show = (side: unknown) => {
        const text = (side as FieldValue | null)?.value;
        return text === undefined ? null : <FieldText text={text} />;
      };
      return plain(value.name, show(before), show(after));
    }
  }
}

/** The issue's key before or after a project move, which Jira logs as its own Key change: people search by old keys. */
const IssueKey = ({ value }: { value: unknown }) => {
  const key = (value as NamedValue | null)?.key;
  return key ? <> ({key})</> : null;
};

/** A status change's resolution, from the same Jira entry: "Ready to deploy" and "Done" are different ends (Linear has none). */
const Resolution = ({ value }: { value: unknown }) => {
  const resolution = (value as { resolution?: string } | null)?.resolution;
  return resolution ? (
    <>
      {" "}
      and set resolution to <B>{resolution}</B>
    </>
  ) : null;
};

/** Jira field values that are links (an app writes `<a href="url">text</a>` or wiki `[text|url]`) open as links. */
const HTML_LINK = /^<a\s[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>$/is,
  WIKI_LINK = /^\[([^|\]]+)\|([^\]]+)\]$/;
function FieldText({ text }: { text: string }) {
  const decoded = text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim();
  const html = decoded.match(HTML_LINK),
    wiki = decoded.match(WIKI_LINK);
  const [url, title] = html ? [html[1]!, html[2]!.replace(/<[^>]+>/g, "")] : wiki ? [wiki[2]!, wiki[1]!] : [];
  if (url && URL.canParse(url) && /^https?:/.test(url))
    return (
      <a href={url} target="_blank" rel="noreferrer" className="hover:text-fg">
        {title || url}
      </a>
    );
  return text;
}

/** One label behind its 4px dot (Linear's label chip in history). */
const LabelName = ({ name }: { name: string }) => (
  <span>
    <span className="mr-1 inline-block size-1 rounded-full align-middle" style={{ background: hue(name) }} />
    {name}
  </span>
);
/** Linear's spelled-out list (`GOn`): the first `spell` names, then "N {more}" with the rest on hover, unless only one
 *  would be left over; joined "a, b, and c" (`XOn`). */
export function LabelList({ names, spell, more = "others" }: { names: string[]; spell: number; more?: string }) {
  const shown = names.length - spell >= 2 ? spell : names.length,
    rest = names.slice(shown),
    total = shown + (rest.length ? 1 : 0);
  const separator = (i: number) => (i === total - 1 ? "" : i === total - 2 ? (total >= 3 ? ", and " : " and ") : ", ");
  return (
    <>
      {names.slice(0, shown).map((name, i) => (
        <span key={name}>
          <LabelName name={name} />
          {separator(i)}
        </span>
      ))}
      {rest.length > 0 && (
        <span title={rest.join(", ")} data-tip="above">
          {rest.length} {more}
        </span>
      )}
    </>
  );
}

const plural = (word: string, count: number) => (count === 1 ? word : `${word}s`);
/** Linear's label entries (`As` spells out 5, `js` 3); a change that does both reads "added … and removed …" (`ss`). */
function LabelChange({ before, after }: { before: string[] | null; after: string[] | null }) {
  const { added, removed } = labelDelta(before, after);
  return (
    <>
      {added.length > 0 && (
        <>
          added {plural("label", added.length)} <LabelList names={added} spell={5} />
        </>
      )}
      {added.length > 0 && removed.length > 0 && " and "}
      {removed.length > 0 && (
        <>
          removed {plural("label", removed.length)} <LabelList names={removed} spell={3} />
        </>
      )}
    </>
  );
}

/** Linear's grouped label row (`yc`): what the run added, removed, added and then removed, or removed and then added.
 *  Linear sorts a label it both added and removed by which came first, so a label removed, added and removed again read
 *  "removed and then added" while it ended off. Here each label is placed by where it started and ended, so the summary
 *  is always the run's net result: on at the end reads "added", off "removed", and only a label back where it started
 *  reads "added and then removed" (it was off) or "removed and then added" (it was on). */
export function GroupedLabels({ changes }: { changes: PropertyActivity[] }) {
  const runs = new Map<string, { first: "added" | "removed"; last: "added" | "removed" }>();
  for (const change of changes) {
    const delta = labelDelta(change.before, change.after);
    for (const side of ["added", "removed"] as const)
      for (const label of delta[side]) runs.set(label, { first: runs.get(label)?.first ?? side, last: side });
  }
  const labels = (test: (run: { first: string; last: string }) => boolean) =>
    [...runs].filter(([, run]) => test(run)).map(([label]) => label);
  const addedOnly = labels((run) => run.first === "added" && run.last === "added"),
    removedOnly = labels((run) => run.first === "removed" && run.last === "removed"),
    addedThenRemoved = labels((run) => run.first === "added" && run.last === "removed"),
    removedThenAdded = labels((run) => run.first === "removed" && run.last === "added");
  const both = [...addedThenRemoved, ...removedThenAdded];
  const tight = addedOnly.length > 0 && removedOnly.length > 0 && both.length > 0;
  const parts = [
    addedOnly.length > 0 && (
      <>
        added <LabelList names={addedOnly} spell={removedOnly.length === 0 && both.length === 0 ? 5 : 3} more="other labels" />
      </>
    ),
    removedOnly.length > 0 && (
      <>
        removed <LabelList names={removedOnly} spell={2} more="labels" />
      </>
    ),
    addedThenRemoved.length > 0 && (
      <>
        {tight ? "added and removed" : "added and then removed"} <LabelList names={addedThenRemoved} spell={2} more="labels" />
      </>
    ),
    removedThenAdded.length > 0 && (
      <>
        {tight ? "removed and added" : "removed and then added"} <LabelList names={removedThenAdded} spell={2} more="labels" />
      </>
    ),
  ].filter((part) => part !== false);
  if (!parts.length) return "made label changes";
  const join = (i: number) =>
    parts.length === 2
      ? addedThenRemoved.length || removedThenAdded.length
        ? ", "
        : " and "
      : i < parts.length - 2
        ? ", "
        : ", and ";
  return parts.map((part, i) => (
    <span key={i}>
      {part}
      {i < parts.length - 1 && join(i)}
    </span>
  ));
}

/** Linear's grouped status row (`so`): two moves read "moved to A, then to B"; a run back to where it started, "moved to
 *  A, then back to B"; a longer one names its ends, "moved (back) from A to B", by the board's column order (`oo`). */
function groupedStatus(changes: PropertyActivity[], issue: Issue): ReactNode {
  const board = boardOf(issue.key),
    first = changes[0]!,
    last = changes.at(-1)!;
  const label = (value: unknown) => statusById(board, idOf(value))?.name ?? (value === null ? "" : name(value));
  const end = <Resolution value={last.after} />;
  if (first.before === null || last.after === null) return <>moved from {label(first.before)} to {label(last.after)}{end}</>;
  const index = (value: unknown) => statuses(board).findIndex((s) => s.id === idOf(value));
  const from = index(first.before),
    to = index(last.after);
  if (idOf(first.before) === idOf(last.after) || (from >= 0 && from === to))
    return <>moved to {label(changes.at(-2)!.after)}, then back to {label(last.after)}{end}</>;
  // Linear's `so` reads "moved to A, then to B", which hides where the run started; Jira shows every from → to, so the
  // start is named too.
  if (changes.length === 2) return <>moved from {label(first.before)} to {label(first.after)}, then to {label(last.after)}{end}</>;
  return <>{from >= 0 && to >= 0 && from > to ? "moved back" : "moved"} from {label(first.before)} to {label(last.after)}{end}</>;
}

/** Linear's grouped priority row (`pc`). */
function GroupedPriority({ changes, issue }: { changes: PropertyActivity[]; issue: Issue }) {
  const last = changes.at(-1)!;
  if (changes.length === 2)
    return (
      <>
        {describeActivity(changes[0]!, issue)},{" "}
        {last.after === null ? "then removed priority" : <>then set to <B>{String(last.after)}</B></>}
      </>
    );
  return last.after === null ? (
    "changed priority a few times before removing it"
  ) : (
    <>
      changed priority a few times before setting it to <B>{String(last.after)}</B>
    </>
  );
}

/** A grouped row's words without its actors: Linear's for status, priority, labels and titles; ", then …" for cycles. */
function describeGroup(changes: PropertyActivity[], issue: Issue): ReactNode {
  switch (changes[0]!.field) {
    case "status":
      return groupedStatus(changes, issue);
    case "priority":
      return <GroupedPriority changes={changes} issue={issue} />;
    case "labels":
      return <GroupedLabels changes={changes} />;
    case "title":
      return titleChangeLabel(changes.length);
    case "weblink":
      return `added ${changes.length} links`;
    case "cycle":
      return <GroupedCycles changes={changes} />;
    case "relation": {
      const first = changes[0]!, last = changes.at(-1)!;
      const before = first.before as Relation | null, after = last.after as Relation | null;
      if (changes.length === 2 && before && after && before.key === after.key && before.kind !== after.kind) {
        const label = (relation: Relation) => LINEAR_RELATIONS.find(([kind]) => kind === relation.kind)?.[1].toLowerCase() ?? relation.label ?? relation.kind;
        return <>changed the relation with <B>{after.key}</B> from <B>{label(before)}</B> to <B>{label(after)}</B></>;
      }
      return <GroupedRelations changes={changes} />;
    }
  }
  return changes.map((change, i) => (
    <span key={change.id}>
      {i ? ", then " : ""}
      {describeActivity(change, issue, i > 0)}
    </span>
  ));
}

/** Linear eo/to: name the first cycle and count moves, retaining each underlying change. */
function GroupedCycles({ changes }: { changes: PropertyActivity[] }) {
  const delta = (event: PropertyActivity) => {
    const before = (event.before as NamedValue[] | null) ?? [], after = (event.after as NamedValue[] | null) ?? [];
    return { added: after.filter((s) => !before.some((b) => b.id === s.id)), removed: before.filter((s) => !after.some((a) => a.id === s.id)) };
  };
  const first = delta(changes[0]!), last = delta(changes.at(-1)!);
  const moves = changes.filter((e) => { const d = delta(e); return d.added.length && d.removed.length; }).length;
  const cycle = (items: NamedValue[]) => <B>{items.map((s) => s.name).join(", ")}</B>;
  const added = first.added.length > 0 && first.removed.length === 0;
  const removed = last.added.length === 0;
  if (added && moves) return <>added issue to {cycle(first.added)} and {removed ? <>moved through {countWord(moves)} cycles and then removed it from {cycle(last.removed)}</> : moves === 1 ? <>moved to {cycle(last.added)}</> : <>moved through {countWord(moves)} cycles to {cycle(last.added)}</>}</>;
  if (removed) return moves ? <>moved issue through {countWord(moves)} {plural("cycle", moves)} and then removed it from {cycle(last.removed)}</> : <>removed issue from {cycle(last.removed)}</>;
  return <>moved issue through {countWord(changes.length)} cycles to {cycle(last.added)}</>;
}

/** Linear mo: collapse related/duplicate additions and removals by target. */
function GroupedRelations({ changes }: { changes: PropertyActivity[] }) {
  const targets = new Map<string, boolean[]>();
  const kind = ((changes[0]!.after ?? changes[0]!.before) as Relation).kind === "related" ? "related" : "duplicate";
  for (const change of changes) {
    const key = ((change.after ?? change.before) as Relation).key;
    targets.set(key, [...(targets.get(key) ?? []), !!change.after]);
  }
  if (targets.size === 1) {
    const [key, actions] = [...targets][0]!;
    const verb = actions.length === 2 && actions[0] !== actions[1] ? actions[0] ? "added and then removed from" : "removed and then restored to" : actions.at(-1) ? "added to" : "removed from";
    return <><B>{key}</B> {verb} {kind} issues</>;
  }
  const added = [...targets].filter(([, actions]) => actions.at(-1)).map(([key]) => key).reverse();
  const removed = targets.size - added.length;
  if (added.length && removed) return <>Added {countWord(added.length)} {kind} {plural("issue", added.length)} and removed {countWord(removed)}</>;
  const keys = added.length ? added : [...targets.keys()].reverse();
  return keys.length <= 2 ? <>{added.length ? "" : "Removed "}{keys.join(" and ")} {added.length ? "added to" : "from"} {kind} issues</> : <>{added.length ? "Added" : "Removed"} {countWord(keys.length)} {kind} issues</>;
}

/** Linear's grouped-row actors (`R`): "A", "A and B", "A, B and C", "A, B and 2 others". */
export function actorNames(changes: PropertyActivity[]): string {
  const names = [...new Map(changes.map((change) => [change.actor.id, change.actor.name])).values()];
  if (names.length < 3) return names.join(" and ");
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} ${plural("other", names.length - 2)}`;
}

const FIELD_ICONS: Partial<Record<PropertyActivity["field"], IconName>> = {
  labels: "label",
  due: "calendar",
  title: "pencil",
  description: "file",
  project: "layers",
  milestone: "calendar",
  cycle: "clock",
  parent: "branch",
  attachment: "paperclip",
  flag: "flag",
  estimate: "priority",
};

/** The row's icon in Linear (RAJ-52): the new status or priority, the label glyph, the assignee, the field's glyph;
 *  a row of several changes, or a change Linear has no glyph for, shows the actor. */
export function ActivityIcon({ row, issue }: { row: ActivityRow; issue: Issue }) {
  const last = row.chain.at(-1) ?? row.events[0]!;
  // Linear's link entry shows who linked it (`ls`); a group of links, the link glyph (`Ua`).
  if (row.field === "weblink") return row.chain.length ? <Icon name="link" /> : <ActivityActorAvatar actor={row.actor} />;
  if (row.field === "relation") return <RelationIcon kind={((last.after ?? last.before) as Relation).kind} />;
  if (row.field === "status") {
    const status = statusById(boardOf(issue.key), idOf(last.after));
    if (status) {
      if (row.chain.length) {
        const from = statuses(boardOf(issue.key)).findIndex((s) => s.id === idOf(row.events[0]!.before));
        const to = statuses(boardOf(issue.key)).findIndex((s) => s.id === idOf(last.after));
        return <span className="relative inline-flex" data-grouped-status-direction={from > to ? "backward" : "forward"}><StatusIcon status={status} /><svg className="absolute top-0" style={from > to ? { right: -5 } : { left: -5, transform: "rotate(180deg)" }} width="8" height="14" viewBox="0 0 8 14" fill="currentColor" aria-hidden="true"><path d="M3.22598 11.4783C2.60746 12.4742 1.78878 13.3328 0.826172 13.9979C0.88385 13.9993 0.941698 14 0.999713 14C4.86571 14 7.99971 10.866 7.99971 7C7.99971 3.13401 4.86571 0 0.999713 0C0.941783 0 0.884016 0.000703812 0.826422 0.00210309C1.78901 0.66726 2.60765 1.5259 3.22615 2.52183C4.87022 3.3408 5.99971 5.0385 5.99971 7C5.99971 8.96157 4.87014 10.6593 3.22598 11.4783Z" /></svg></span>;
      }
      return <StatusIcon status={status} />;
    }
  }
  if (row.field === "priority") return <PriorityIcon name={(last.after as string | null) ?? undefined} />;
  if (row.field === "type" && last.after) return <TypeDot type={last.after as string} />;
  if (row.field === "assignee") return <Avatar user={assignee(last.after)} size={14} />;
  const icon = row.field !== "multi" && FIELD_ICONS[row.field];
  if (icon) return <Icon name={icon} />;
  return <ActivityActorAvatar actor={row.actor} />;
}

/** Jira's history names an assignee without a picture; the board's people list may have it. */
const assignee = (value: unknown): User | null => {
  if (!value || typeof value !== "object") return null;
  const user = value as User;
  return user.avatar ? user : (get().options.users.find((u) => u.id === user.id) ?? user);
};

/** A person's or app's (Jira Automation) avatar, from Jira's history when it gave one. */
export function ActivityActorAvatar({ actor }: { actor: ActivityRow["actor"] }) {
  return <Avatar user={actor as User} size={14} />;
}

/** An Activity entry other than a comment thread: its DOM id (for links to it) and its part in a folded row's summary. */
export type ActivityItem = TimelineEvent & { anchor: string; summary: SummaryItem[] };

/** A run of entries between comment threads, folded the way Linear folds a long one (`ActivityHistoryCollapse`): the
 *  middle becomes one "Show N events: …" row that unfolds the whole run. A link to a folded entry opens it. */
export function ActivityRun({ events, place }: { events: ActivityItem[]; place: RunPlace }) {
  const [now] = useState(Date.now);
  const [open, setOpen] = useState(() => events.some((event) => location.hash === `#${event.anchor}`));
  const { before, hidden, after } = partition(events, {
    position: place.position,
    now,
    at: (event) => event.at,
    nextDiscussion: place.nextThread,
  });
  if (open || !hidden.length) return events.map((event) => event.node);
  const label = collapseLabel(
    hidden.length,
    hidden.flatMap((event) => event.summary),
  );
  return (
    <>
      {before.map((event) => event.node)}
      <ActivityEntry
        data-activity-collapsed
        icon={
          <button
            type="button"
            aria-label="Expand all activity"
            onClick={() => setOpen(true)}
            className="grid size-[14px] place-items-center text-fg-3 hover:text-fg-2"
          >
            <ExpandActivityIcon />
          </button>
        }
      >
        <button type="button" onClick={() => setOpen(true)} className="text-left hover:text-fg-2">
          {label}
        </button>
      </ActivityEntry>
      {after.map((event) => event.node)}
    </>
  );
}

/** Linear ExpandChevronIconLarge: opposing chevrons, 16px viewbox. */
export function ExpandActivityIcon() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" clipRule="evenodd" d="M7.523 2.71a.75.75 0 0 1 .954 0l4.25 3.5a.75.75 0 0 1-.954 1.157L8 4.26 4.227 7.367a.75.75 0 0 1-.954-1.158l4.25-3.5Zm5.306 7.102a.75.75 0 0 1-.102 1.055l-4.25 3.5a.75.75 0 0 1-.954 0l-4.25-3.5a.75.75 0 0 1 .954-1.158L8 12.817l3.773-3.108a.75.75 0 0 1 1.056.103Z" /></svg>;
}

/** A row's words: its actor and change, or a grouped row's actors and Linear's grouped wording. */
export function ActivityRowWords({ row, issue }: { row: ActivityRow; issue: Issue }) {
  if (row.chain.length) {
    const changes = [...row.events, ...row.chain];
    return (
      <>
        <span className="font-medium">{actorNames(changes)}</span> {describeGroup(changes, issue)}
      </>
    );
  }
  return (
    <>
      <span className="font-medium">{row.actor.name}</span>{" "}
      {row.events.map((change, i) => (
        <span key={change.id}>
          {i ? " and " : ""}
          {describeActivity(change, issue)}
        </span>
      ))}
    </>
  );
}

/**
 * Linear's `ActivityHistoryEntry`: the icon in its own box, then the words, " · " and the time as one run of text, so a long
 * row wraps beside the icon, never under it, and the time ends the last line (non-breaking spaces and Linear's `nowrap` date
 * keep "· time" together). A row without a time (Linear's folded "Show N events" row, which its PR timeline renders through the
 * same entry, `eo` in PullRequestTitleInput, with no timestamp) is the icon and its words alone. `detail` sits under the row,
 * as Linear's expanded changes do. A row outside a list (the inbox's folded-group line) renders as a `div`.
 */
export function ActivityEntry({
  as: Row = "li",
  icon,
  time,
  detail,
  children,
  ...props
}: {
  as?: "li" | "div";
  icon: ReactNode;
  time?: ReactNode;
  detail?: ReactNode;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "className">) {
  return (
    <Row {...props} className="activity-event">
      <span className="activity-event-icon">{icon}</span>
      <span className="activity-event-text">
        <span className="activity-event-words">{children}</span>
        {time !== undefined && (
          <>
            {"\u00a0·\u00a0"}
            <span className="whitespace-nowrap">{time}</span>
          </>
        )}
      </span>
      {detail}
    </Row>
  );
}

/** Linear B/V: a grouped row toggles its indented changes, each with its own absolute time. */
export function ActivityPropertyRow({ row, issue, children }: { row: ActivityRow; issue: Issue; children: ReactNode }) {
  const changes = [...row.events, ...row.chain];
  const [open, setOpen] = useState(() => changes.some((e) => location.hash === `#activity-${e.id}`));
  const grouped = row.chain.length > 0;
  const text = <ActivityRowWords row={row} issue={issue} />;
  return (
    <ActivityEntry
      id={`activity-${row.id}`}
      data-activity={row.field}
      icon={<ActivityIcon row={row} issue={issue} />}
      time={children}
      detail={
        grouped && open ? (
          <ol className="basis-full border-l border-border pl-6" aria-label="Grouped changes">
            {changes.map((change) => (
              <li key={change.id} id={`activity-change-${change.id}`} className="py-2">
                <span className="font-medium">{change.actor.name}</span> {describeActivity(change, issue)} ·{" "}
                <time dateTime={change.at} title={activityTime(change.at)}>
                  {fullTime(change.at)}
                </time>
              </li>
            ))}
          </ol>
        ) : null
      }
    >
      {grouped ? (
        <button type="button" className="text-left hover:text-fg-2" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {text}
        </button>
      ) : (
        text
      )}
    </ActivityEntry>
  );
}

/** Linear L spells counts through twenty in grouped-history descriptions. */
function countWord(count: number): string | number {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
  return words[count] ?? count;
}
export function titleChangeLabel(count: number): string {
  return `changed title ${count === 2 ? "twice" : `${countWord(count)} times`}`;
}
