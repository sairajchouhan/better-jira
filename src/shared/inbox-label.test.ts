import { expect, test } from "bun:test";
import { notificationLabel, notificationTitle } from "./inbox-label";

const note = (kind: Parameters<typeof notificationLabel>[0]["kind"], message = "") => ({ kind, message });

test("each Jira kind takes Linear's short label", () => {
  expect(notificationLabel(note("assigned", "Ana assigned a task to you"))).toBe("Assigned");
  expect(notificationLabel(note("unassigned", "Ana unassigned a task from you"))).toBe("Unassigned");
  expect(notificationLabel(note("mentioned", "Ana mentioned you in a comment"))).toBe("Mentioned in comment");
  expect(notificationLabel(note("mentioned", "Ana mentioned you on a task"))).toBe("Mentioned in issue");
  expect(notificationLabel(note("comment", "Ana commented on a task"))).toBe("New comment");
  expect(notificationLabel(note("reaction", "Ana reacted to your comment"))).toBe("Reacted to comment");
  expect(notificationLabel(note("created", "Ana created a task"))).toBe("New issue");
  expect(notificationLabel(note("updated", "You have 1 item due today"))).toBe("Due");
  expect(notificationLabel(note("updated", "You have 3 items due tomorrow"))).toBe("Due");
  expect(notificationLabel(note("updated", "Ana changed the due date of a task"))).toBe("Updated");
  expect(notificationLabel(note("updated", "Ana updated a task"))).toBe("Updated");
});

test("a status change reads the issue's state type now, as Linear's shortLabel", () => {
  const status = note("status", "Ana changed a task from To Do to Done");
  expect(notificationLabel(status, "Completed")).toBe("Completed");
  expect(notificationLabel(status, "Canceled")).toBe("Canceled");
  expect(notificationLabel(status, "Duplicate")).toBe("Duplicate");
  expect(notificationLabel(status, "Started")).toBe("Status updated");
  expect(notificationLabel(status)).toBe("Status updated");
});

test("the title names the issue after the label, or the label alone without one", () => {
  expect(notificationTitle({ ...note("comment"), key: "RAJ-47", title: "implement hard push" })).toBe(
    "New comment: RAJ-47 implement hard push",
  );
  expect(notificationTitle({ ...note("updated", "You have 1 item due today"), key: "", title: "View work" })).toBe("Due");
});
