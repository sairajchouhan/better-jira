// Phase 2c integration stub; replaced by phase 2a's full-page editor at merge.
import type { ReactElement, ReactNode, JSX } from "react";
import type { SavedView, ViewDraft } from "./saved-views";
export function openViewEditor(_draft: ViewDraft): void {}
export function ViewMenu({
  children,
}: {
  view: SavedView;
  children: ReactElement;
}): JSX.Element {
  return <>{children}</>;
}
export function ViewContextMenu({
  children,
}: {
  view: SavedView;
  children: ReactNode;
}): JSX.Element {
  return <>{children}</>;
}
