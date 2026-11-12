import type { ComponentProps } from "react";
import { createLink } from "@tanstack/react-router";
import { linkTo, navigate, openSavedView } from "./app-navigation";
import { locationOf } from "@/client/routes/tree";
import type { SavedView } from "@/shared/saved-view-model";
import type { Destination } from "./navigation";

/**
 * A link to somewhere in the app: a real address (⌘-click and middle-click open a new tab), its issue and screen
 * loaded on hover, and a plain click that goes there from the screen as it is now, as the app's own steps do.
 */
export function AppLink({ to, onClick, ...props }: { to: Destination } & ComponentProps<"a">) {
  return <NavigationLink routeLocation={linkTo(to)} go={() => navigate(to)} onClick={onClick} {...props} />;
}

export function SavedViewLink({ view, ...props }: { view: SavedView } & ComponentProps<"a">) {
  return <NavigationLink routeLocation={locationOf({ to: "view", id: view.id }, { view: () => view })} go={() => openSavedView(view)} {...props} />;
}

// The app's selected screen owns aria-current (a list can stay selected under an issue).
const Link = createLink(function NavigationAnchor({ current, ...props }: ComponentProps<"a"> & { current?: ComponentProps<"a">["aria-current"] }) {
  return <a {...props} aria-current={current} />;
});

function NavigationLink({ routeLocation, go, onClick, onKeyDown, ...props }: { routeLocation: ReturnType<typeof linkTo>; go: () => void } & ComponentProps<"a">) {
  return (
    <Link
      {...routeLocation}
      {...props}
      current={props["aria-current"]}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && event.key === " " && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
          event.preventDefault();
          event.currentTarget.click();
        }
      }}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        go();
      }}
    />
  );
}
