import { Tab, TabList, Tabs, type Key, type TabListProps, type TabProps } from "react-aria-components";
import type { ButtonSize } from "./button";
import { SELECT_ON_RELEASE } from "./tabs";
import "./control-tokens.css";
import "./segmented-control.css";

/**
 * Linear's SegmentedControl (`J4`, trigger/indicator `$Tr`, sizes `eEr`, startup-root.CnUSfl4j.js): Base UI Tabs with
 * `activationMode` "automatic" by default, so arrows select as they move and wrap, as React Aria's Tabs do. Segment sizes are
 * the Button table; the track and selected fill swap tertiary shades between light and dark.
 */

/** A pill of mutually exclusive choices; name it with `aria-label`. */
function SegmentedControlRoot({
  value,
  onValueChange,
  size = "normal",
  width = "content",
  className = "",
  ...props
}: {
  value: string;
  onValueChange: (value: string) => void;
  size?: ButtonSize;
  width?: "content" | "full";
  className?: string;
} & Omit<TabListProps<object>, "className">) {
  return (
    <Tabs selectedKey={value} onSelectionChange={(key: Key) => onValueChange(String(key))} className="contents">
      <TabList data-size={size} data-width={width} className={`ui-segmented ${className}`} {...props} />
    </Tabs>
  );
}

export const SegmentedControl = Object.assign(SegmentedControlRoot, {
  Segment: ({ value, className = "", ...props }: { value: string; className?: string } & Omit<TabProps, "id" | "className">) => (
    <Tab id={value} className={`ui-segment ${className}`} {...SELECT_ON_RELEASE} {...props} />
  ),
});
