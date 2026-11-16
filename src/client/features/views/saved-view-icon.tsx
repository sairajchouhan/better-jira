import { Icon, type IconName } from "@/client/components/icons";
import type { SavedView } from "./saved-views";

/** A saved view's icon (Linear's `rk`): its emoji, or its named icon at 16px, in its colour. */
export function SavedViewIcon({ view }: { view: Pick<SavedView, "icon" | "color"> }) {
  return <span aria-hidden="true" className="inline-flex shrink-0" style={{ color: view.color === "gray" ? "var(--view-gray)" : view.color }}>
    {/[^\x00-\x7F]/.test(view.icon) ? view.icon : <Icon name={view.icon as IconName} size={16} />}
  </span>;
}
