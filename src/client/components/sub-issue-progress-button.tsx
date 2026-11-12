import type { ComponentProps } from "react";
import { ProgressRing } from "./icons";
import "./control-tokens.css";
import "./sub-issue-progress-button.css";

/** Linear at → ZB/QB: the same rounded badge in the parent header and sub-issue rows. */
export function SubIssueProgressButton({
  completed,
  total,
  variant,
  className = "",
  ...props
}: {
  completed: number;
  total: number;
  variant: "header" | "row";
} & ComponentProps<"button">) {
  return (
    <button type="button" className={`sub-issue-progress-button ${className}`} data-variant={variant} {...props}>
      <span className="sub-issue-progress-icon"><ProgressRing value={total ? completed / total : 0} /></span>
      <span className="sub-issue-progress-count">{completed}/{total}</span>
    </button>
  );
}
