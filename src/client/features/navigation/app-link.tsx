import type { ComponentProps } from "react";
import { Link } from "@tanstack/react-router";
import { linkTo, navigate } from "./app-navigation";
import type { Destination } from "./navigation";

/**
 * A link to somewhere in the app: a real address (⌘-click and middle-click open a new tab), its issue and screen
 * loaded on hover, and a plain click that goes there from the screen as it is now, as the app's own steps do.
 */
export function AppLink({ to, onClick, ...props }: { to: Destination } & ComponentProps<"a">) {
  return (
    <Link
      {...(linkTo(to) as { to: string })}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        navigate(to);
      }}
    />
  );
}
