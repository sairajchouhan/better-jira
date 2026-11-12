import type { ComponentProps } from "react";
import type { ButtonSize } from "./button";
import { TablistProvider, useTablistProps, useTabProps } from "./tablist";
import "./control-tokens.css";
import "./segmented-control.css";

/**
 * Linear's SegmentedControl (`J4`, trigger/indicator `$Tr`, sizes `eEr`, startup-root.CnUSfl4j.js). Segment sizes are
 * the Button table; the track and selected fill swap tertiary shades between light and dark.
 */

/** A pill of mutually exclusive choices; arrows move (and, by default, select), Home/End jump to the ends. */
function SegmentedControlRoot({
  value,
  onValueChange,
  activation,
  size = "normal",
  width = "content",
  className = "",
  ...props
}: Pick<ComponentProps<typeof TablistProvider>, "value" | "onValueChange" | "activation"> & {
  size?: ButtonSize;
  width?: "content" | "full";
} & ComponentProps<"div">) {
  return (
    <TablistProvider value={value} onValueChange={onValueChange} activation={activation}>
      <SegmentList data-size={size} data-width={width} className={`ui-segmented ${className}`} {...props} />
    </TablistProvider>
  );
}

function SegmentList(props: ComponentProps<"div">) {
  return <div {...useTablistProps()} {...props} />;
}

export const SegmentedControl = Object.assign(SegmentedControlRoot, {
  Segment: function Segment({ value, className = "", onClick, ...props }: { value: string } & ComponentProps<"button">) {
    return <button className={`ui-segment ${className}`} {...useTabProps(value, onClick)} {...props} />;
  },
});
