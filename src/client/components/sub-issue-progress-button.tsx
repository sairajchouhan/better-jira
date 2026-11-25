import type { ComponentProps } from "react";
import { Badge } from "./badge";
import { ProgressRing } from "./icons";
import "./control-tokens.css";
import "./sub-issue-progress-button.css";

/**
 * Linear at → ZB/QB: the sub-issue progress pill, a progress ring then "done/total". `header` and `row` are the issue page's parent
 * line and sub-issue rows; `badge` is a board card's or list row's badge (IssueList `wd`, issueWidgetFieldPreferences `at`), drawn
 * as every other card badge (`Badge`), its ring at 14px (`Dd.roundProgressIcon`).
 */
export function SubIssueProgressButton({
  completed,
  total,
  variant,
  className = "",
  ...props
}: {
  completed: number;
  total: number;
  variant: "header" | "row" | "badge";
} & ComponentProps<"button">) {
  const ring = <ProgressRing value={total ? completed / total : 0} />;
  if (variant === "badge")
    return (
      <Badge.Button data-sub-issue-progress="" className={className} {...props}>
        <Badge.Icon>{ring}</Badge.Icon>
        <Badge.Text>
          {completed}/{total}
        </Badge.Text>
      </Badge.Button>
    );
  return (
    <button type="button" className={`sub-issue-progress-button ${className}`} data-variant={variant} {...props}>
      <span className="sub-issue-progress-icon">{ring}</span>
      <span className="sub-issue-progress-count">{completed}/{total}</span>
    </button>
  );
}
