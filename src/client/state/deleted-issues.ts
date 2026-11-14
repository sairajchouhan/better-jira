import { navigate } from "@/client/features/navigation/app-navigation";
import { subIssueDraftKey } from "@/client/features/issue/sub-issue-draft";
import { showNotification } from "./app-notifications";
import { get } from "./store";

/**
 * Issues Jira no longer has (deleted there, or moved off every board), found by the property poll or by a write's answer.
 * Their inline sub-issue drafts go too, since no composer can reach them again, and the open one says why it closed
 * instead of dropping the user on the board without a word (R3-create-D7).
 */
export function issuesDeletedInJira(keys: string[]) {
  if (!keys.length) return;
  const { namespace, selected } = get();
  let dropped = false;
  for (const key of keys)
    try {
      const draft = subIssueDraftKey(namespace, key);
      if (localStorage.getItem(draft) === null) continue;
      localStorage.removeItem(draft);
      if (key === selected) dropped = true;
    } catch {}
  if (!selected || !keys.includes(selected)) return;
  navigate({ selected: null, panel: false });
  showNotification({
    text: `${selected} was deleted in Jira`,
    detail: dropped ? "It is no longer on your boards. Its unsaved sub-issue draft was discarded." : "It is no longer on your boards.",
  });
}
