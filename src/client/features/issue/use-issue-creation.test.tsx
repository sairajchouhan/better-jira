import { expect, test } from "bun:test";
import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useIssueCreation } from "./use-issue-creation";

test("R3 G18: the issue's creation is one object across renders, so its description history is not rebuilt each render", () => {
  const issue = { created: undefined, creator: undefined };
  const fields = { created: "2026-01-01T10:00:00Z", reporter: { accountId: "a1", displayName: "Ada", avatarUrls: {} } };
  const seen: unknown[] = [];
  function Activity() {
    const [pass, setPass] = useState(0);
    seen.push(useIssueCreation(issue, fields));
    // A render-phase update renders the component again with its hooks kept: a second render with the same inputs.
    if (pass === 0) setPass(1);
    return null;
  }
  renderToStaticMarkup(<Activity />);
  expect(seen).toHaveLength(2);
  expect(seen[0]).toEqual({ at: "2026-01-01T10:00:00Z", actor: { id: "a1", name: "Ada", avatar: undefined } });
  expect(seen[1]).toBe(seen[0]);
});
