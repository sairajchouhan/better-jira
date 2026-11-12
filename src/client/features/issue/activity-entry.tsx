/**
 * One property row's words and icon, in Linear's wording (its issue-history chunk `IssueCommentsAndHistory`, read 2026-11-12):
 * the entry builders `ws` (status), `Es` (priority), `Os` (assignee), `ks` (title), `As`/`js` (labels), `tc` (estimate),
 * `ic` (due date), `Us` (parent), `Ws` (team), `Js` (cycle), `Qs` (project), `ec` (milestone) and `Hs` (relations).
 * Jira-only kinds (resolution, component, files, custom fields) read plainly in the same pattern: "changed Fix version from A to B".
 */
import type { ReactNode } from "react";
import { statusById } from "@/shared/board-catalog";
import { Avatar } from "@/client/components/avatar";
import { Icon, type IconName, PriorityIcon, RelationIcon, StatusIcon, TypeDot, hue } from "@/client/components/icons";
import { AppLink } from "@/client/features/navigation/app-link";
import { boardOf, get } from "@/client/state/store";
import type { Issue, User } from "@/shared/issue-model";
import { jiraLinkType } from "@/shared/relations";
import type { ActivityRow, PropertyActivity, Relation } from "./issue-activity";
import type { FieldValue, NamedValue } from "./jira-history";

const related = (target: Issue) => ({ board: target.board, selected: target.key, panel: true, view: get().view });

const name = (value: unknown) =>
  value && typeof value === "object" && "name" in value ? String((value as { name: unknown }).name) : String(value);
const idOf = (value: unknown) =>
  value && typeof value === "object" && "id" in value ? (value as { id: unknown }).id : value;
/** Linear's `formatAbsoluteDate`: "Nov 7". */
const day = (value: unknown) =>
  new Date(`${value}T00:00`).toLocaleDateString("en", { month: "short", day: "numeric" });
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
  return target ? (
    <AppLink to={related(target)} className="hover:text-fg">
      <b className="font-medium">{relation.key}</b> {target.summary}
    </AppLink>
  ) : (
    <>
      <b className="font-medium">{relation.key}</b>
      {relation.issue && ` ${relation.issue.summary}`}
    </>
  );
}

/** Jira's remote link text, 'This work item links to "Wiki Page (Confluence)"', as its title. */
const webLinkTitle = (text: string) => text.match(/links to "(.*)"$/)?.[1] ?? text;

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
    case "status":
      return then || before === null
        ? `moved to ${status(after)}`
        : `moved from ${status(before)} to ${status(after)}`;
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
      if (after === null) return "removed assignee";
      if (idOf(after) === actor.id) return "self-assigned the issue";
      return then || before === null ? `assigned to ${name(after)}` : `re-assigned to ${name(after)}`;
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
      // TitleChangeTooltipContent: the new title, cut at 70 characters, with the old one on hover.
      return (
        <>
          changed title to <B title={`Previously: ${before ?? ""}`}>{title.length > 70 ? `${title.slice(0, 70)}…` : title}</B>
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
          changed project from <B>{name(before)}</B> to <B>{name(after)}</B>
        </>
      );
    case "cycle": {
      // `Js` with `appendWord: "cycle"`; Jira's sprints already say "Sprint".
      const cycle = (value: unknown) => {
        const text = name(value);
        return /cycle|sprint/i.test(text) ? <B>{text}</B> : <><B>{text}</B> cycle</>;
      };
      if (after === null) return <>removed issue from {cycle(before)}</>;
      return before === null ? <>added issue to {cycle(after)}</> : <>moved issue to {cycle(after)}</>;
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
      return after === null ? (
        <>
          removed from milestone <B>{name(before)}</B>
        </>
      ) : (
        <>
          added to milestone <B>{name(after)}</B>
        </>
      );
    case "weblink": {
      const link = (after ?? before) as NamedValue;
      return (
        <>
          {after ? "linked" : "removed link"}{" "}
          <span className="inline-flex align-[-2px]">
            <Icon name="link" size={12} />
          </span>{" "}
          <B>{webLinkTitle(link.name)}</B>
        </>
      );
    }
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
    case "comment":
      return "deleted a comment";
    case "description":
      return "updated the description";
    case "flag":
      return after === null ? "removed the flag" : "flagged the issue";
    case "type":
      return then && after !== null ? `set to ${after}` : plain("issue type", before as string | null, after as string | null);
    case "resolution":
      return plain("resolution", before as string | null, after as string | null);
    case "field": {
      const value = (after ?? before) as FieldValue;
      return plain(
        value.name,
        (before as FieldValue | null)?.value ?? null,
        (after as FieldValue | null)?.value ?? null,
      );
    }
  }
}

/** Linear's label entries (`As`/`js`): each label behind its 4px dot. */
function LabelChange({ before, after }: { before: string[] | null; after: string[] | null }) {
  const was = new Set(before ?? []),
    now = new Set(after ?? []),
    added = [...now].filter((l) => !was.has(l)),
    removed = [...was].filter((l) => !now.has(l));
  const list = (names: string[]) =>
    names.map((l, i) => (
      <span key={l}>
        {i ? ", " : ""}
        <span className="mr-1 inline-block size-1 rounded-full align-middle" style={{ background: hue(l) }} />
        {l}
      </span>
    ));
  return (
    <>
      {added.length > 0 && (
        <>
          added label{added.length > 1 ? "s" : ""} {list(added)}
        </>
      )}
      {added.length > 0 && removed.length > 0 && " and "}
      {removed.length > 0 && (
        <>
          removed label{removed.length > 1 ? "s" : ""} {list(removed)}
        </>
      )}
    </>
  );
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
  weblink: "link",
  comment: "comment",
  flag: "flag",
  estimate: "priority",
};

/** The row's icon in Linear (RAJ-52): the new status or priority, the label glyph, the assignee, the field's glyph;
 *  a row of several changes, or a change Linear has no glyph for, shows the actor. */
export function ActivityIcon({ row, issue }: { row: ActivityRow; issue: Issue }) {
  const last = row.chain.at(-1) ?? row.events[0]!;
  if (row.field === "relation") return <RelationIcon kind={((last.after ?? last.before) as Relation).kind} />;
  if (row.field === "status") {
    const status = statusById(boardOf(issue.key), idOf(last.after));
    if (status) return <StatusIcon status={status} />;
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
