import { expect, test } from "bun:test";
import { onStoredChange } from "@/client/state/stored-state";
import { get } from "@/client/state/store";
import "./app-navigation";

/** What another tab's localStorage write looks like here. */
const storage = (key: string, newValue: string | null) => dispatchEvent(Object.assign(new Event("storage"), { key, newValue }));

test("R3-chrome-D6: hiding or showing the sidebar in another tab does the same here", () => {
  const before = get().sidebarHidden;
  storage("better-jira:sidebar", before ? "shown" : "hidden");
  expect(get().sidebarHidden).toBe(!before);
  // The same state again changes nothing.
  storage("better-jira:sidebar", before ? "shown" : "hidden");
  expect(get().sidebarHidden).toBe(!before);
  storage("better-jira:sidebar", before ? "hidden" : "shown");
  expect(get().sidebarHidden).toBe(before);
});

test("R3-chrome-D6: stored UI state (sidebar section collapse) rereads when another tab writes its key", () => {
  const heard: string[] = [];
  const stop = onStoredChange("better-jira:sidebar:v1", () => heard.push("sidebar"));
  storage("better-jira:sidebar:v1", '{"collapsed":["boards"]}');
  storage("better-jira:other", "{}");
  stop();
  storage("better-jira:sidebar:v1", "{}");
  expect(heard).toEqual(["sidebar"]);
});
