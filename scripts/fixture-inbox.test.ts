import { expect, test } from "bun:test";
import { markGroup } from "./fixture-inbox";

test("R3 G14: the fixture inbox marks a group's earlier notifications with its head", () => {
  const head = { readState: "unread" },
    older = { readState: "unread" };
  const group = { readStates: ["unread"], headNotification: head, children: [head, older] };
  markGroup(group, true);
  expect([group.readStates, head.readState, older.readState]).toEqual([["read"], "read", "read"]);
  markGroup(group, false);
  expect([group.readStates, head.readState, older.readState]).toEqual([["unread"], "unread", "unread"]);
});
