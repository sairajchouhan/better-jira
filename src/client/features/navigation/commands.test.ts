import { expect, test } from "bun:test";
import { Glob } from "bun";

const source = async (pattern: string) => {
  const files: Record<string, string> = {};
  const root = `${import.meta.dir}/../..`;
  for await (const path of new Glob(pattern).scan(root))
    if (!path.includes(".test.")) files[path] = await Bun.file(`${root}/${path}`).text();
  return files;
};
const names = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map((m) => m[1]!);

test("every command a shortcut sends has a handler some owner registers", async () => {
  const files = await source("**/*.{ts,tsx}");
  const shortcuts = files["features/navigation/shortcuts.tsx"]!;
  // shortcuts.tsx imports `run` as `command`.
  expect(shortcuts).toContain('run as command } from "./commands"');
  const sent = new Set([
    ...names(shortcuts, /(?<![\w.])command\(\s*"([\w-]+)"/g),
    ...names(shortcuts, /(?<![\w.])post\(\s*"([\w-]+)"/g),
    // `focus(...)` sends the command it is given.
    ...names(shortcuts, /(?<![\w.])focus\(\s*"([\w-]+)"/g),
  ]);
  const handled = new Set(
    Object.values(files).flatMap((text) => names(text, /useCommand\(\s*"([\w-]+)"/g)),
  );
  const declared = names(files["features/navigation/commands.ts"]!, /^ {2}"([\w-]+)": \{ arg/gm);
  expect(sent.size).toBeGreaterThan(5);
  for (const name of sent) expect({ name, declared: declared.includes(name) }).toEqual({ name, declared: true });
  for (const name of declared) expect({ name, handled: handled.has(name) }).toEqual({ name, handled: true });
});

test("a posted command waits for its owner; a run one reaches only a mounted owner", async () => {
  const { handle, kept, post, run } = await import("./commands");
  expect(run("focus-find")).toBeUndefined();
  post("issue-options-start", "due");
  expect(kept("issue-options-start")).toBe("due");
  // An owner that declines leaves it waiting for the next.
  const declines = handle("issue-options-start", (start) => (start === "link" ? true : undefined));
  expect(kept("issue-options-start")).toBe("due");
  let custom = false;
  const takes = handle("issue-options-start", (start) => (start === "due" ? (custom = true) : undefined));
  expect([custom, kept("issue-options-start")]).toEqual([true, undefined]);
  takes();
  declines();
  const stop = handle("hovered-sub-issue", () => "A-1");
  expect(run("hovered-sub-issue")).toBe("A-1");
  stop();
  expect(run("hovered-sub-issue")).toBeUndefined();
});

test("edit and expanded-create intents are delivered once when their owner mounts", async () => {
  const { handle, kept, post } = await import("./commands");
  for (const name of ["edit-description", "create-expanded"] as const) {
    post(name, "A-1" as never);
    let count = 0;
    const stop = handle(name, () => { count++; return true; });
    expect(count).toBe(1);
    expect(kept(name)).toBeUndefined();
    stop();
    const again = handle(name, () => { count++; return true; });
    expect(count).toBe(1);
    again();
  }
});

test("an issue intent lapses once its issue is left, so it never reaches another issue's owner", async () => {
  const { forgetIssueIntents, handle, kept, post } = await import("./commands");
  // Ctrl+M on A-1 while its details load: the comment box is not there yet.
  post("focus-comment", "A-1");
  forgetIssueIntents("A-1");
  expect(kept("focus-comment")).toBe("A-1");
  // Esc, then B-2 opens and its comment box mounts.
  forgetIssueIntents(null);
  forgetIssueIntents("B-2");
  let taken: string | undefined;
  const stop = handle("focus-comment", (key) => (key === "B-2" ? ((taken = key), true) : undefined));
  expect([taken, kept("focus-comment")]).toEqual([undefined, undefined]);
  stop();
  // Board intents are not issue intents.
  post("issue-options-start", "due");
  forgetIssueIntents(null);
  expect(kept("issue-options-start")).toBe("due");
  forgetIssueIntents(null);
});
