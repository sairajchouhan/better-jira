import { expect, test } from "bun:test";
import { pullRequestStatusIn, type PullRequest } from "./pull-requests";

const pr = (url: string, status: "open" | "draft" | "merged" | "closed") => ({ url, status }) as PullRequest;

test("a pull request link takes the state of the same pull request in any list read, whatever its case or trailing path", () => {
  const lists = [
    [["pull-requests", "A-1"], undefined],
    [["pull-requests", "A-2"], [pr("https://github.com/acme/widgets/pull/7", "open"), pr("https://github.com/Acme/Widgets/pull/42", "merged")]],
  ] as [unknown, PullRequest[] | undefined][];
  expect(pullRequestStatusIn(lists, "https://github.com/acme/widgets/pull/42/files")).toBe("merged");
  expect(pullRequestStatusIn(lists, "https://github.com/acme/widgets/pull/43")).toBeUndefined();
  expect(pullRequestStatusIn(lists, "https://example.com/acme/widgets/pull/42")).toBeUndefined();
});
