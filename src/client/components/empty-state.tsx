import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { ProgressBar } from "react-aria-components";
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

/** Keeps the boot shell (index.html #loading) over whatever it holds until that has its first data: boot-shell.ts hands
 *  over only once no `data-app-loading` element is left. Linear's boot fallback positioner (`mr`, LoadApplicationLayout),
 *  which wraps its fallbacks the same way. After boot the shell is gone and the children show as they are. */
export function AppLoading({ className = "", ...props }: ComponentProps<"div">) {
  return <div data-app-loading aria-busy className={`flex min-h-0 flex-1 flex-col ${className}`} {...props} />;
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

/** Linear's skeleton lines (`Gjn`, startup-root): three bars, each 50–100% wide (drawn once per page load, as Linear's
 *  `Wjn`), fading in after 250ms so a quick load never flashes them. */
const SKELETON_WIDTHS = Array.from({ length: 3 }, () => `${Math.round(50 + Math.random() * 50)}%`);

/** Waiting on a document's text: Linear's document fallback (`Jjn`, exported as `XO`; the issue description editor's
 *  `fallback`), which holds 190px for the text so what sits below it starts where a short text will leave it. */
export function DocumentLoadingState({ className = "", ...props }: ComponentProps<"div">) {
  return (
    <div role="status" aria-busy className={`ui-document-loading ${className}`} {...props}>
      <span className="sr-only">Loading…</span>
      <div className="ui-skeleton-lines" aria-hidden>
        {SKELETON_WIDTHS.map((width, i) => (
          <div key={i} className="ui-skeleton-line" style={{ width }} />
        ))}
      </div>
    </div>
  );
}

/** Linear's loading caret (`GI` placed by `akt`, the LoadingContainer `$Ot` in startup-root): an 8×16 labelBase block 14px down
 *  its positioned parent's top-left (the `noPadding` place), hidden for `delay` then blinking every second. React Aria's
 *  ProgressBar gives it the progressbar role and label Linear's bare div lacks. */
export function LoadingCaret({ label, delay = LOADING_CARET_DELAY }: { label: string; delay?: number }) {
  return (
    <ProgressBar
      isIndeterminate
      aria-label={label}
      className="ui-loading-caret"
      style={{ "--ui-loading-caret-delay": `${delay}ms` } as CSSProperties}
    />
  );
}
/** `tkt`: the caret's default delay, so a load under a second never shows it. */
export const LOADING_CARET_DELAY = 1000;
