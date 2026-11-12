import type { ComponentProps, ReactNode } from "react";
import { Text } from "./text";
import "./control-tokens.css";
import "./empty-state.css";

/**
 * Linear's EmptyState container (`r`, EmptyState.Dw0r4kIJ.js) and the ViewEmptyState layout (`x`, ViewEmptyState.DLTlzQ6O.js):
 * a 340px column, title in regularPlus labelBase, paragraphs in small labelMuted, 16px apart, then actions 8px apart
 * (Linear uses medium Buttons there).
 */
export const EMPTY_STATE = { PADDING: 3, MAX_WIDTH: 340, GAP: 24, TEXT_GAP: 8, PARAGRAPH_GAP: 16, ACTION_GAP: 8 } as const;

/** The centred, scrollable frame both states share. */
function Frame({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`ui-empty-state ${className}`} {...props} />;
}

/** Nothing to show yet. Children are the paragraphs (Text "small" in labelMuted, 16px apart). */
export function EmptyState({
  icon,
  title,
  actions,
  children,
  ...props
}: { icon?: ReactNode; title: ReactNode; actions?: ReactNode } & ComponentProps<"div">) {
  return (
    <Frame {...props}>
      <div className="ui-empty-state-body">
        {icon && <div aria-hidden>{icon}</div>}
        <div className="ui-empty-state-text">
          <Text as="h2" variant="regularPlus" color="base">
            {title}
          </Text>
          {children && <div className="ui-empty-state-paragraphs">{children}</div>}
        </div>
        {actions && <div className="ui-empty-state-actions">{actions}</div>}
      </div>
    </Frame>
  );
}

/** Waiting on data: one muted line, announced politely. */
export function LoadingState({ children = "Loading…", ...props }: ComponentProps<"div">) {
  return (
    <Frame role="status" aria-busy {...props}>
      <Text variant="small" color="muted">
        {children}
      </Text>
    </Frame>
  );
}
