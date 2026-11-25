type ReadState = "read" | "unread";
type FixtureGroup = {
  readStates: string[];
  headNotification: { readState: string };
  /** The group's notifications, head first, as Jira's `notificationGroup` lists them. */
  children?: unknown[];
};

/** Marks a fixture Jira notification group read or unread as Jira does: the head and every earlier notification in it. */
export function markGroup(group: FixtureGroup, read: boolean) {
  const state: ReadState = read ? "read" : "unread";
  group.readStates = [state];
  group.headNotification.readState = state;
  for (const child of group.children ?? []) (child as { readState: string }).readState = state;
}
