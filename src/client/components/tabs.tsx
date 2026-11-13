import type { ComponentProps } from "react";
import { TablistProvider, useTablistProps, useTabPanelProps, useTabProps } from "./tablist";
import "./control-tokens.css";
import "./tabs.css";

/**
 * `header`: Linear's header view tabs, measured in .raj/linear.md: 28px pills, 4px apart.
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

/** Arrow keys move between tabs (wrapping, skipping disabled), Home/End jump to the ends. */
function TabsRoot({
  value,
  onValueChange,
  children,
}: Pick<ComponentProps<typeof TablistProvider>, "value" | "onValueChange" | "children">) {
  return (
    <TablistProvider value={value} onValueChange={onValueChange}>
      {children}
    </TablistProvider>
  );
}

export const Tabs = Object.assign(TabsRoot, {
  /** Name it with `aria-label`. Summary and options tabs share the full row. */
  List: ({
    variant = "header",
    className = "",
    ...props
  }: { variant?: "header" | "summary" | "options" } & ComponentProps<"div">) => (
    <div
      data-variant={variant}
      className={`ui-tabs-list ${className}`}
      {...useTablistProps()}
      {...props}
    />
  ),
  Tab: function Tab({ value, className = "", onClick, ...props }: { value: string } & ComponentProps<"button">) {
    return <button className={`ui-tab ${className}`} {...useTabProps(value, onClick)} {...props} />;
  },
  /** Optional: the content a tab shows, hidden while another tab is selected. */
  Panel: ({ value, ...props }: { value: string } & ComponentProps<"div">) => <div {...useTabPanelProps(value)} {...props} />,
});
