import type { ComponentProps, CSSProperties } from "react";
import "./control-tokens.css";
import "./text.css";

/** Linear's Text `_4` and its variant table `d4` (startup-entry.Dt5YDWdY.js): [font size px, weight, line height, letter spacing]. */
export const TEXT = {
  micro: [11, 450, "normal"],
  microPlus: [11, 500, "normal"],
  mini: [12, 450, "normal"],
  miniPlus: [12, 500, "normal"],
  small: [13, 450, "normal"],
  smallPlus: [13, 500, "normal"],
  regular: [15, 450, "1.4375rem"],
  regularPlus: [15, 600, "1.4375rem"],
  large: [18, 450, "normal"],
  largePlus: [18, 500, "normal"],
  title1: [36, 450, "2.875rem"],
  title2: [24, 500, "2rem", "-0.01rem"],
  title3: [20, 500, "normal", "-0.01rem"],
} as const;

export type TextVariant = keyof typeof TEXT;

/**
 * Typography from Linear's table. `color` maps labelTitle/Base/Muted/Faint onto --fg…--fg-4; `wrap="truncate"` is
 * Linear's `truncate` (`pretty` its `wrap: "pretty"`), `numeric="tabular"` its `tabularNums`. `lines` is Linear's numeric
 * `truncate` (`truncateMultiline(n)`): at most that many lines, the last one ending in an ellipsis.
 */
export function Text({
  as = "span",
  variant = "regular",
  color = "title",
  align = "left",
  wrap = "wrap",
  numeric = "proportional",
  lines,
  className = "",
  style,
  ...props
}: {
  as?: "span" | "p" | "div" | "h1" | "h2" | "h3" | "label";
  variant?: TextVariant;
  color?: "title" | "base" | "muted" | "faint" | "inherit";
  align?: "left" | "center" | "right";
  wrap?: "wrap" | "nowrap" | "truncate" | "pretty";
  numeric?: "proportional" | "tabular";
  lines?: number;
} & ComponentProps<"span">) {
  // One element type for typing; the rendered tag is `as`.
  const Tag = as as "span";
  return (
    <Tag
      data-variant={variant}
      data-color={color}
      data-align={align}
      data-wrap={wrap}
      data-numeric={numeric}
      data-lines={lines}
      className={`ui-text ${className}`}
      style={lines ? ({ ...style, "--lines": lines } as CSSProperties) : style}
      {...props}
    />
  );
}
