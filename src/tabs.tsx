import type { ComponentProps } from "react";
import { TablistProvider, useTablistProps, useTabPanelProps, useTabProps } from "./tablist";
import "./control-tokens.css";
import "./tabs.css";

/** Linear's header view tabs, measured in .raj/linear.md ("Tabs"): 28px full-radius pills, 4px apart. */
export const TABS = { HEIGHT: 28, PADDING_INLINE: 10, GAP: 4, FONT_SIZE: 12, FONT_WEIGHT: 500 } as const;

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
  /** Name it with `aria-label`. */
  List: ({ className = "", ...props }: ComponentProps<"div">) => (
    <div className={`ui-tabs-list ${className}`} {...useTablistProps()} {...props} />
  ),
  Tab: function Tab({ value, className = "", onClick, ...props }: { value: string } & ComponentProps<"button">) {
    return <button className={`ui-tab ${className}`} {...useTabProps(value, onClick)} {...props} />;
  },
  /** Optional: the content a tab shows, hidden while another tab is selected. */
  Panel: ({ value, ...props }: { value: string } & ComponentProps<"div">) => <div {...useTabPanelProps(value)} {...props} />,
});
