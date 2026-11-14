import { createContext, use, type ComponentProps, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Icon } from "./icons";
import "./filter-block.css";

/**
 * The one applied-filter UI, wherever filters apply (board, list, views, inbox, search). Linear draws every model's filters the
 * same way: ContentViewHeaderFilterPanel (`W`/`G`/`K`) holds UniversalCustomFilterPanel's FilterPanelBlocks for issues and
 * notifications alike (Inbox renders ContentViewSubheader's `S` with modelType "notification"; issue views its `x`).
 *
 *   <FilterBar label="Temporary filters">
 *     <FilterBar.Blocks>
 *       <FilterBlock onRemove={remove}>
 *         <FilterBlock.Field>Status</FilterBlock.Field>
 *         <FilterBlock.Operator label="status operator" onOpen={…}>is</FilterBlock.Operator>
 *         <FilterBlock.Value label="status value" icons={…} onOpen={…}>Todo</FilterBlock.Value>
 *         <FilterBlock.Remove label="Remove status filter" />
 *       </FilterBlock>
 *       {add button}
 *     </FilterBar.Blocks>
 *     <FilterBar.Actions>{Clear, Save}</FilterBar.Actions>
 *   </FilterBar>
 *
 * A bar without actions is Linear's inbox panel (`S` passes no `side`); views pass Clear and Save (`x`'s side).
 */
function FilterBarRoot({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className={`ui-filter-bar ${className}`}>
      {children}
    </div>
  );
}

/** How a segment's menu was opened: a pointer opens it pristine (no row highlighted), a key highlights its first row. */
export type OpenedBy = "pointer" | "keyboard";
export const openedBy = (event: MouseEvent) => (event.detail > 0 ? "pointer" : "keyboard") as OpenedBy;

const RemoveContext = createContext<(() => void) | null>(null);

/** Linear's FilterBlock: one applied filter as joined segments. Backspace or Delete on a focused segment removes it. */
function FilterBlockRoot({
  onRemove,
  children,
  ...props
}: { onRemove: () => void; children: ReactNode } & Omit<ComponentProps<"div">, "className" | "onKeyDown">) {
  const removeOnKey = (event: KeyboardEvent) => {
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    event.preventDefault();
    onRemove();
  };
  return (
    <RemoveContext value={onRemove}>
      <div className="ui-filter-block" onKeyDown={removeOnKey} {...props}>
        {children}
      </div>
    </RemoveContext>
  );
}

type SegmentButton = {
  /** The accessible name: "status operator", "From value". */
  label?: string;
  /** Whether this segment's menu is open. */
  expanded?: boolean;
  onOpen: (anchor: HTMLElement, by: OpenedBy) => void;
  title?: string;
  children: ReactNode;
};

function Segment({ label, expanded, onOpen, title, className, children }: SegmentButton & { className: string }) {
  return (
    <button
      type="button"
      className={`ui-filter-segment ${className}`}
      aria-label={label}
      aria-expanded={expanded}
      title={title}
      onClick={(event) => onOpen(event.currentTarget, openedBy(event))}
    >
      {children}
    </button>
  );
}

export const FilterBar = Object.assign(FilterBarRoot, {
  /** The blocks and the trailing "+" add button, wrapping. */
  Blocks: ({ children }: { children: ReactNode }) => <div className="ui-filter-blocks">{children}</div>,
  /** The panel's `side`: Clear and Save, past a 20px gap. */
  Actions: ({ children }: { children: ReactNode }) => <div className="ui-filter-actions">{children}</div>,
});

export const FilterBlock = Object.assign(FilterBlockRoot, {
  /** The field's name: "Status", "From". */
  Field: ({ children }: { children: ReactNode }) => (
    <span className="ui-filter-segment">
      <span>{children}</span>
    </span>
  ),
  /** The operator, muted; opens the operator menu. */
  Operator: ({ children, ...props }: SegmentButton) => (
    <Segment className="ui-filter-operator" {...props}>
      <span>{children}</span>
    </Segment>
  ),
  /** The values: up to three icons (Linear's imageForValues) and their name or count; opens the value menu. */
  Value: ({ icons, children, ...props }: SegmentButton & { icons?: ReactNode[] }) => (
    <Segment className="ui-filter-value" {...props}>
      {icons?.some(Boolean) && (
        <span className="ui-filter-icons">
          {icons.slice(0, 3).map((icon, i) => icon && <span key={i}>{icon}</span>)}
        </span>
      )}
      <span>{children}</span>
    </Segment>
  ),
  /** The trailing ×: removes the block. */
  Remove: ({ label }: { label: string }) => {
    const remove = use(RemoveContext)!;
    return (
      <button type="button" className="ui-filter-segment ui-filter-remove" aria-label={label} onClick={remove}>
        <Icon name="x" size={12} />
      </button>
    );
  },
});
