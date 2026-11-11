// Phase 2a integration stub. Replaced by the full editor and menus at merge.
import type React from "react";
import type { SavedView, ViewDraft } from "./saved-views";
export function openViewEditor(_draft: ViewDraft): void {}
export function ViewMenu(props: { view: SavedView; children: React.ReactElement }): React.JSX.Element { return props.children; }
export function ViewContextMenu(props: { view: SavedView; children: React.ReactNode }): React.JSX.Element { return <>{props.children}</>; }
