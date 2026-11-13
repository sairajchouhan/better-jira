import type { ReactNode } from "react";
import { ViewOptions } from "@/client/components/display-options";
import { IconButton } from "@/client/components/button";
import { Icon } from "@/client/components/icons";
import { Sortable } from "@/client/components/sortable";
import { Text } from "@/client/components/text";
import { moveGroup, type Bucket, type Grouping } from "@/shared/view-model";
import { GroupIcon } from "./group-icon";
import { useViewGroups } from "./view-groups";
import { hideGroup, setGroupOrder, showGroup } from "./view-settings";
import "./group-ordering.css";

/**
 * Linear's Group ordering page, opened in place of the Display options by the button beside Grouping (linear.app,
 * 2026-11-13). Under a Back header, the shown groups are a sortable list (drag handle, icon, name, Hide group); after them
 * come the groups not shown, faded and without a handle: a group the user hid offers Show group, and an empty group is
 * listed with Show group disabled ("Empty groups are hidden") until Show empty groups is on. The order and hidden groups are
 * the view's display preferences (view-settings), never written to Jira.
 */
export function GroupOrdering({ board, by, onBack }: { board: number; by: Grouping; onBack: () => void }) {
  const groups = useViewGroups(board);
  const hidden = new Set(groups?.hidden);
  const shown = groups?.columns.filter((c) => !hidden.has(c)) ?? [];
  const ids = shown.map((c) => c.id);
  return (
    <>
      <ViewOptions.PageHeader onBack={onBack}>Group ordering</ViewOptions.PageHeader>
      <div className="ui-group-ordering">
        <Sortable
          ids={ids}
          onMove={(id, target) => setGroupOrder(board, moveGroup(groups!.columns.map((c) => c.id), id, target))}
        >
          {shown.map((c) => (
            <Sortable.Item key={c.id} id={c.id}>
              <Sortable.Handle label={`Reorder ${c.name}`}>
                <Sortable.Grip />
              </Sortable.Handle>
              <GroupRow bucket={c} by={by} variant="sortable">
                <IconButton label="Hide group" tooltip={false} variant="borderless" size="small" className="ui-group-toggle" onClick={() => hideGroup(board, c.id)}>
                  <Icon name="eye" />
                </IconButton>
              </GroupRow>
            </Sortable.Item>
          ))}
        </Sortable>
        {groups?.hidden.map((c) => {
          const userHidden = groups.hiddenIds.includes(c.id);
          return (
            <GroupRow key={c.id} bucket={c} by={by} variant="hidden">
              <IconButton
                label="Show group"
                tooltip={false}
                variant="borderless"
                size="small"
                className="ui-group-toggle"
                disabled={!userHidden}
                disabledReason="Empty groups are hidden"
                onClick={() => showGroup(board, c.id)}
              >
                <Icon name="eye-off" />
              </IconButton>
            </GroupRow>
          );
        })}
      </div>
    </>
  );
}

/** One group: its icon and name, then its Hide or Show button. A sortable row leaves room for its handle; a hidden one fades. */
function GroupRow({
  bucket,
  by,
  variant,
  children,
}: {
  bucket: Bucket;
  by: Grouping;
  variant: "sortable" | "hidden";
  children: ReactNode;
}) {
  return (
    <div className="ui-group-row" data-variant={variant} data-group={bucket.name}>
      <div className="ui-group-name">
        <span className="ui-group-icon">
          <GroupIcon bucket={bucket} by={by} />
        </span>
        <Text variant="small" color="base" wrap="truncate">
          {bucket.name}
        </Text>
      </div>
      {children}
    </div>
  );
}
