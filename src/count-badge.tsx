import type { ComponentProps } from "react";
import "./count-badge.css";

/** Linear's Badge (`sv`, styles `sEe`, startup-root.CnUSfl4j.js): 11px/450 muted tabular numbers; filled adds 3px 6px on controlTertiarySelected. */
export const COUNT_BADGE = { FONT_SIZE: 11, FONT_WEIGHT: 450, BORDER_RADIUS: 4, FILLED_PADDING: [3, 6] } as const;

export function CountBadge({
  background = "none",
  className = "",
  ...props
}: { background?: "none" | "filled" } & ComponentProps<"span">) {
  return <span data-background={background} className={`ui-count-badge ${className}`} {...props} />;
}
