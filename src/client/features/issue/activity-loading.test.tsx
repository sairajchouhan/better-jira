import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityGate, ActivityLoadingState, revealStep } from "./activity-loading";
import { LOADING_CARET_DELAY } from "@/client/components/empty-state";

// Linear: IssueCommentsAndHistory.O0coD7-k.js `Hl` in a SuspenseObserver (startup-root `Hv`) with fallback `Oi`
// (DuplicatedByIcon.OM-Otn7o.js `u`: 300px, LoadingContainer `$Ot` noPadding); the caret `GI`/`akt`, `tkt` = 1000ms.
const dir = new URL("../../", import.meta.url);
const indexCss = await Bun.file(new URL("index.css", dir)).text();
const loadingCss = await Bun.file(new URL("components/empty-state.css", dir)).text();
const issueView = await Bun.file(new URL("routes/issue-view.tsx", dir)).text();
const rule = (css: string, selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
};

test("activity loading: while loading, the Activity shows Linear's fallback and none of its rows or its comment box", () => {
  const html = renderToStaticMarkup(
    <ActivityGate ready={false} fadeIn={false}>
      <div id="comment">box</div>
    </ActivityGate>,
  );
  expect(html).not.toContain('id="comment"');
  expect(html).toContain("data-activity-loading");
  expect(html).toMatch(/role="progressbar"[^>]*aria-label="Loading activity"|aria-label="Loading activity"[^>]*role="progressbar"/);
});

test("activity loading: once loaded, the rows and comment box show together, fading in only after the fallback had shown", () => {
  const after = renderToStaticMarkup(
    <ActivityGate ready fadeIn>
      <div id="comment">box</div>
    </ActivityGate>,
  );
  expect(after).toContain('id="comment"');
  expect(after).toContain("ui-suspense-fade-in");
  expect(after).not.toContain("data-activity-loading");
  // Already there (cached history): shown as it is, as Linear's local data shows with no fade.
  expect(renderToStaticMarkup(<ActivityGate ready fadeIn={false}>x</ActivityGate>)).not.toContain("ui-suspense-fade-in");
});

test("activity loading: the issue's Activity puts its comments and comment box inside the gate, under the Activity heading", () => {
  const gate = issueView.indexOf("<ActivityGate ready={loaded}");
  const end = issueView.indexOf("</ActivityGate>");
  expect(gate).toBeGreaterThan(issueView.indexOf(">\n          Activity\n"));
  const inside = issueView.slice(gate, end);
  expect(inside).toContain("<CommentThreads");
  expect(inside).toContain("<CommentComposer");
  expect(issueView).toContain("useActivityReveal(firstKey(issue.key), !f || pending)");
});

test("activity loading: details Jira refused never leave the caret blinking; the Activity stays out as before", () => {
  expect(issueView).toContain("const detailsFailed = !f && !!detailsError;");
  expect(issueView.indexOf("if (detailsFailed) return null;")).toBeLessThan(issueView.indexOf("<ActivityGate ready={loaded}"));
});

test("activity loading: the fallback keeps Linear's 300px, the caret 14px down at its left edge", () => {
  const box = rule(indexCss, ".activity-loading");
  expect(box).toContain("position: relative;");
  expect(box).toContain("height: 300px;");
  expect(renderToStaticMarkup(<ActivityLoadingState />)).toContain('class="activity-loading"');
  // The comment box's -8px sides belong to it, not to whatever is last in the section (the fallback, while loading).
  expect(indexCss).not.toContain(".issue-activity > div:last-child");
  expect(rule(indexCss, ".issue-activity-composer")).toContain("margin-inline: -8px;");
});

test("activity loading: Linear's caret: 8×16, 2px radius, labelBase, hidden for a second, then blinking every second", () => {
  const caret = rule(loadingCss, ".ui-loading-caret");
  for (const value of [
    "position: absolute;",
    "top: 14px;",
    "left: 0;",
    "width: 8px;",
    "height: 16px;",
    "border-radius: 2px;",
    "background-color: var(--fg-2);",
    "opacity: 0;",
    "animation: ui-loading-caret-blink 1s cubic-bezier(0.25, 0.46, 0.45, 0.94) var(--ui-loading-caret-delay, 1000ms) infinite;",
  ])
    expect(caret).toContain(value);
  expect(LOADING_CARET_DELAY).toBe(1000);
  expect(renderToStaticMarkup(<ActivityLoadingState />)).toContain("--ui-loading-caret-delay:1000ms");
  const blink = loadingCss.slice(loadingCss.indexOf("@keyframes ui-loading-caret-blink"));
  expect(blink.replace(/\s+/g, " ")).toStartWith(
    "@keyframes ui-loading-caret-blink { 0%, 40%, to { opacity: 1; } 50%, 90% { opacity: 0.2; } }",
  );
  expect(rule(loadingCss, ".ui-suspense-fade-in")).toContain("animation: 80ms ui-suspense-fade-in;");
});

test("activity loading: an issue's first read shows the fallback, then its content, and never the fallback again", () => {
  let reveal = revealStep(undefined, "KAN-1", true);
  expect(reveal).toEqual({ identity: "KAN-1", ready: false, waited: true });
  reveal = revealStep(reveal, "KAN-1", false);
  expect(reveal).toEqual({ identity: "KAN-1", ready: true, waited: true });
  // A newer read of the same issue (or the Jira key an issue made here gets, the same `firstKey`) keeps the comment box up.
  expect(revealStep(reveal, "KAN-1", true)).toBe(reveal);
});

test("activity loading: another issue in the same pane starts over; one whose history is already here never waits", () => {
  const shown = revealStep(revealStep(undefined, "KAN-1", true), "KAN-1", false);
  expect(revealStep(shown, "KAN-2", true)).toEqual({ identity: "KAN-2", ready: false, waited: true });
  expect(revealStep(shown, "KAN-3", false)).toEqual({ identity: "KAN-3", ready: true, waited: false });
});
