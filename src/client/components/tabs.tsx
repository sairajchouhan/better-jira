import { createContext, use, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import {
  Tab as AriaTab,
  TabList as AriaTabList,
  TabPanel as AriaTabPanel,
  Tabs as AriaTabs,
  type Key,
  type TabListProps,
  type TabPanelProps,
  type TabProps,
} from "react-aria-components";
import "./control-tokens.css";
import "./tabs.css";

/**
 * `header`: Linear's header view tabs, measured: 28px pills, 4px apart.
 * `summary`: ViewDetails' measured 32px triggers, sharing the full row with an 8px gap.
 * `options`: Linear's `sq` Tabs with `fullWidth` (triggers `I_n`, styles `cq`/`V_n`), the Display options List/Board
 * switch: a bgBase track (radius 5, 2px gap, -2px block margin) of 28px triggers with 2px margins that share the row.
 */
export const TABS = {
  HEIGHT: 28,
  PADDING_INLINE: 10,
  GAP: 4,
  FONT_SIZE: 12,
  FONT_WEIGHT: 500,
  SUMMARY: { HEIGHT: 32, PADDING_INLINE: 12, GAP: 8 },
} as const;

/**
 * How the keyboard picks a tab, as Linear's two Base UI tab lists do (startup-root.CnUSfl4j.js):
 * - `manual`: Linear's `sq.List` (`activateOnFocus:!1, loopFocus:!1`): arrows move focus and stop at the ends; Enter or Space
 *   selects.
 * - `automatic`: the icon picker's list and `J4`'s (`activateOnFocus:!0`, Base UI's default `loopFocus:!0`): arrows select as
 *   they move and wrap.
 */
export type TabActivation = "manual" | "automatic";

/** Whether `key` would carry focus past the first or last enabled tab: React Aria's tab list always wraps, `sq` does not. */
export function passesEnd(key: string, current: number, disabled: readonly boolean[]): boolean {
  const enabled = (from: number, to: number) => disabled.slice(from, to).some((off) => !off);
  if (current < 0) return false;
  if (key === "ArrowRight") return !enabled(current + 1, disabled.length);
  if (key === "ArrowLeft") return !enabled(0, current);
  return false;
}

/** React Aria's TabList element, its arrow keys stopping at the ends for a `manual` list. */
function stopAtEnds(props: ComponentProps<"div">) {
  return (
    <div
      {...props}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
        const current = tabs.indexOf(document.activeElement as HTMLElement);
        if (passesEnd(event.key, current, tabs.map((tab) => tab.getAttribute("aria-disabled") === "true"))) {
          event.preventDefault();
          return;
        }
        props.onKeyDown?.(event);
      }}
    />
  );
}

/** Base UI's tab selects on click (`onClick`), not on press; React Aria's useTab takes this, though its Tab type leaves it out. */
export const SELECT_ON_RELEASE = { shouldSelectOnPressUp: true } as object;

const ActivationContext = createContext<TabActivation>("manual");

/** One selected value; React Aria's Tabs owns focus, the roving tab stop, Home/End and disabled tabs. */
function TabsRoot({
  value,
  onValueChange,
  activation = "manual",
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  activation?: TabActivation;
  children: ReactNode;
}) {
  return (
    <ActivationContext value={activation}>
      <AriaTabs
        selectedKey={value}
        onSelectionChange={(key: Key) => onValueChange(String(key))}
        keyboardActivation={activation}
        // No box of its own: the list lays out in its parent as before.
        className="contents"
      >
        {children}
      </AriaTabs>
    </ActivationContext>
  );
}

export const Tabs = Object.assign(TabsRoot, {
  /** Name it with `aria-label`. Summary and options tabs share the full row. */
  List: function TabsList({
    variant = "header",
    className = "",
    ...props
  }: { variant?: "header" | "summary" | "options" } & Omit<TabListProps<object>, "className"> & { className?: string }) {
    const activation = use(ActivationContext);
    return (
      <AriaTabList
        data-variant={variant}
        className={`ui-tabs-list ${className}`}
        render={activation === "manual" ? stopAtEnds : undefined}
        {...props}
      />
    );
  },
  Tab: ({
    value,
    title,
    className = "",
    ...props
  }: { value: string; title?: string; className?: string } & Omit<TabProps, "id" | "className">) => (
    <AriaTab
      id={value}
      className={`ui-tab ${className}`}
      // `title` feeds TitleTooltips; React Aria's Tab passes no title through, so the element takes it here.
      render={title ? (tab) => <div {...(tab as ComponentProps<"div">)} title={title} /> : undefined}
      {...SELECT_ON_RELEASE}
      {...props}
    />
  ),
  /** Optional: the content a tab shows, mounted while its tab is selected. */
  Panel: ({ value, ...props }: { value: string } & Omit<TabPanelProps, "id">) => <AriaTabPanel id={value} {...props} />,
});
