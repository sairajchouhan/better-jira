import { afterEach, expect, test } from "bun:test";
import { pendingConfirmation } from "@/client/features/inbox/inbox";
import { queryClient } from "@/client/state/server-data";
import { get } from "@/client/state/store";
import type { InboxItem } from "@/shared/inbox-model";
import { shortcuts } from "./shortcuts";

const row = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: "n1",
  head: "h1",
  key: "TEST-1",
  title: "one",
  url: "",
  actor: null,
  kind: "comment",
  message: "",
  preview: "",
  time: "2026-11-10T00:00:00Z",
  status: "",
  unread: true,
  category: "direct",
  count: 1,
  link: "",
  commentId: "",
  issueType: "",
  others: [],
  ...over,
});
const feed = (items: InboxItem[]) =>
  queryClient.setQueryData(["inbox", "all"], { pages: [{ items, more: false, writable: false, unseen: 0 }], pageParams: [""] });
const applies = (id: string) => shortcuts.find((s) => s.id === id)!.when!({ ...get(), inbox: true }, undefined);
const BULK = ["inbox-read-all", "inbox-delete-read", "inbox-delete-all", "inbox-delete-completed"];
afterEach(() => queryClient.removeQueries({ queryKey: ["inbox"] }));

test("inbox ⌘K lists a bulk action only while the inbox has something it would act on (Linear's applicable)", () => {
  feed([]);
  expect(BULK.map(applies)).toEqual([false, false, false, false]);
  feed([row()]);
  // One unread row of an open issue: Mark all as read and Delete all; nothing read, nothing completed.
  expect(BULK.map(applies)).toEqual([true, false, true, false]);
  feed([row({ unread: false, status: "Done" })]);
  expect(BULK.map(applies)).toEqual([false, true, true, true]);
});

test("inbox ⌘K lists the notification's own actions only while one is selected", () => {
  feed([row()]);
  for (const id of ["inbox-read", "inbox-snooze", "inbox-backspace", "inbox-delete"]) expect(applies(id)).toBe(false);
});

test("each bulk delete in ⌘K asks its own question first (Linear's zEn, LEn, FEn)", async () => {
  feed([row({ unread: false, status: "Done" })]);
  const asked = async (id: string) => {
    void shortcuts.find((s) => s.id === id)!.run();
    await Promise.resolve();
    const question = pendingConfirmation();
    question?.answer(false);
    return question?.title;
  };
  expect(await asked("inbox-delete-all")).toBe("Delete all notifications?");
  expect(await asked("inbox-delete-read")).toBe("Delete all read notifications?");
  expect(await asked("inbox-delete-completed")).toBe("Delete all read notifications for completed issues?");
});
