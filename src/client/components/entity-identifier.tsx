import type { ComponentProps } from "react";
import "./entity-identifier.css";

/** Linear's `WP` (startup-root.CnUSfl4j.js): an issue key such as "RAJ-46", wherever one is shown. */
export function EntityIdentifier({ className = "", ...props }: ComponentProps<"span">) {
  return <span className={`ui-entity-id ${className}`} {...props} />;
}
