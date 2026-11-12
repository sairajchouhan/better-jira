import type { ComponentProps } from "react";
import { IconButton } from "./button";
import "./media-primitives.css";

/** Disabled controls still explain why they are unavailable on hover. */
export function MediaIconButton({
  disabledReason,
  ...props
}: ComponentProps<typeof IconButton> & { disabledReason?: string }) {
  const button = (
    <IconButton {...props} aria-description={props.disabled ? disabledReason : undefined} />
  );
  return props.disabled && disabledReason ? (
    <span className="media-disabled-action" title={disabledReason}>
      {button}
    </span>
  ) : (
    button
  );
}
