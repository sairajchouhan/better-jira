import type { ComponentProps, ReactNode } from "react";
import { createLink } from "@tanstack/react-router";
import { RouterProvider } from "react-aria-components";
import { issueAt, linkTo, navigate, openSavedView, router, withFavorite } from "./app-navigation";
import { useStore } from "@/client/state/store";
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

/** A link to an issue by its key, whether or not the mirror holds it: it opens here as the screen opens issues (`issueAt`), and
 *  one the mirror doesn't hold is kept first (`navigate`, BJ-354). Every in-app link to another issue (a relation, its hover
 *  card) is this one link. */
export function IssueKeyLink({ issueKey, ...props }: { issueKey: string } & ComponentProps<"a">) {
  // The destination's parts as primitives, so the store's snapshot stays stable; `issueAt` assembles them.
  const board = useStore((s) => issueAt(issueKey, s).board),
    view = useStore((s) => s.view);
  return <AppLink to={{ board, selected: issueKey, panel: true, view }} {...props} />;
}

declare module "react-aria-components" {
  interface RouterConfig {
    /** A React Aria link's destination in the app, beside its `href` (`linkHref(to)`). */
    routerOptions: Destination;
  }
}

/**
 * React Aria's links route through the app: a plain click on one with a `routerOptions` destination goes there as the app's own
 * steps do (AppLink's `navigate`), any other same-origin link through the router. ⌘-click, a target or a download stay the
 * browser's. Their `href` is already the router's (`linkHref`), so no `useHref` is needed.
 */
export function AppRouterProvider({ children }: { children: ReactNode }) {
  return (
    <RouterProvider navigate={(href, to) => (to ? navigate(to) : void router.navigate({ href }))}>{children}</RouterProvider>
  );
}

/** A link opening a saved view; `favorite` when it is the view's Favorites row. */
export function SavedViewLink({ view, favorite, ...props }: { view: SavedView; favorite?: string } & ComponentProps<"a">) {
  const route = withFavorite(locationOf({ to: "view", id: view.id }, { view: () => view }), favorite);
  return <NavigationLink routeLocation={route} go={() => openSavedView(view, favorite)} {...props} />;
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
