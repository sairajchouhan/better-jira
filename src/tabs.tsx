import type { ComponentProps } from "react";
import { TablistProvider, useTablistProps, useTabPanelProps, useTabProps } from "./tablist";
import "./control-tokens.css";
import "./tabs.css";

/**
 * Two looks. `header`: Linear's header view tabs, measured in .raj/linear.md ("Tabs"): 28px full-radius pills, 4px apart.
 * `section`: Linear's Tabs `sq` (startup-root.CnUSfl4j.js, styles `cq`), used by the view summary and PR header: 28px
 * triggers (`Mv` tab/medium) with 12px padding and a 2px margin on a 5px-radius bgBase track, so each row is 32px.
 */
export const TABS = {
  HEIGHT: 28,
  PADDING_INLINE: 10,
  GAP: 4,
  FONT_SIZE: 12,
  FONT_WEIGHT: 500,
  SECTION: { PADDING_INLINE: 12, MARGIN: 2, LIST_GAP: 2, LIST_RADIUS: 5, MAX_WIDTH: 200, ROW_HEIGHT: 32 },
} as const;

/** Arrow keys move between tabs (wrapping, skipping disabled), Home/End jump to the ends. */
function TabsRoot({
  value,
  onValueChange,
  activation,
  children,
}: Pick<ComponentProps<typeof TablistProvider>, "value" | "onValueChange" | "activation" | "children">) {
  return (
    <TablistProvider value={value} onValueChange={onValueChange} activation={activation}>
      {children}
    </TablistProvider>
  );
}

export const Tabs = Object.assign(TabsRoot, {
  /** Name it with `aria-label`. `width="full"` (section only, `sq.List fullWidth`) stretches the tabs to share the row. */
  List: ({
    variant = "header",
    width = "content",
    className = "",
    ...props
  }: { variant?: "header" | "section"; width?: "content" | "full" } & ComponentProps<"div">) => (
    <div
      data-variant={variant}
      data-width={width}
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
