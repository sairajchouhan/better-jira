import { type Issue } from "@/shared/issue-model";
import { showNotification } from "@/client/state/app-notifications";
import { issueText } from "./issue-copy";
import type { ActionEntry } from "@/client/components/action-menu";

/**
 * The coding tools an issue opens in, from Linear's list (`F5t` in startup-root.CnUSfl4j.js), limited to those a web page can
 * launch: each takes the issue's prompt through its desktop app's deep link. Linear's "Claude Code" and "Codex CLI" run a command
 * in a terminal, which needs Linear's desktop app ("Opens in your terminal. Requires the Linear desktop app."), so a browser
 * can't start them and they are left out.
 */
export type CodingTool = { id: string; name: string; description: string; link: (prompt: string) => string };
/** Linear's `YH`: the longest deep link most apps accept. */
const LINK_LIMIT = 2000;
/** Linear's `I5t`, naming Jira. */
export const TRUNCATED = "\n\n[Truncated. Full context available in Jira.]";
/**
 * Linear's `XH`: the deep link for the whole prompt when it fits in `limit` characters, else for the longest start of the prompt
 * that, followed by the truncation note, still fits (a binary search over the prompt's length).
 */
export function promptLink(prompt: string, build: (prompt: string) => string, limit: number): string {
  const whole = build(prompt);
  if (whole.length <= limit) return whole;
  let low = 0,
    high = prompt.length,
    best = build(TRUNCATED);
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    try {
      const link = build(prompt.slice(0, mid) + TRUNCATED);
      if (link.length <= limit) {
        low = mid;
        best = link;
      } else high = mid - 1;
    } catch {
      // A cut through a surrogate pair can't be URI-encoded: try shorter.
      high = mid - 1;
    }
  }
  return best;
}
/** In Linear's order: by name. */
export const CODING_TOOLS: readonly CodingTool[] = [
  {
    id: "claudeCodeDesktop",
    name: "Claude Code desktop",
    description: "Opens in the Claude desktop app",
    link: (p) => promptLink(p, (q) => `claude://code/new?q=${encodeURIComponent(q)}`, LINK_LIMIT),
  },
  {
    id: "codex",
    name: "Codex desktop",
    description: "Opens in the Codex desktop app",
    link: (p) => promptLink(p, (q) => `codex://new?prompt=${encodeURIComponent(q)}`, LINK_LIMIT),
  },
  {
    id: "cursor",
    name: "Cursor",
    description: "Opens in the Cursor desktop app",
    // Cursor's link takes the prompt encoded twice, and up to 8,000 characters.
    link: (p) =>
      promptLink(p, (q) => `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(encodeURIComponent(q))}`, 8000),
  },
  {
    id: "t3Code",
    name: "T3 Code",
    description: "Opens in the T3 Code desktop app",
    link: (p) => promptLink(p, (q) => `t3code://new?prompt=${encodeURIComponent(q)}`, LINK_LIMIT),
  },
];
/** Linear's `V.navigateExternal`: a link clicked in a new target, so the browser hands the app's scheme to the system. */
function openExternal(link: string) {
  const anchor = document.createElement("a");
  anchor.href = link;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.click();
  anchor.remove();
}
/** Linear's open-in action (`V5t` with `z5t`): an "Opening X…" toast, the issue's prompt as the tool's deep link, and "Failed to
 *  open X" when the prompt can't be built. Linear also moves the issue to started (startIssueOnOpenInExternalApp); this doesn't. */
export async function openInCodingTool(tool: CodingTool, issue: Issue) {
  showNotification({ text: `Opening ${tool.name}…` });
  try {
    openExternal(tool.link(await issueText("as prompt", issue)));
  } catch (error) {
    showNotification({ text: `Failed to open ${tool.name}`, detail: error instanceof Error ? error.message : undefined });
  }
}
/** Linear's "Work on issue…" (`K5t`): one "Open in X" row per tool (`L5t`, keywords open and open in). ⌘K lists them as the
 *  issue's values from 2 characters ("Work on issue › Open in Cursor"); `close` runs before the tool opens. */
export const workOnIssueEntry = (issue: Issue, close: () => void): ActionEntry => ({
  name: "Work on issue…",
  icon: "external",
  children: CODING_TOOLS.map((tool) => ({
    name: `Open in ${tool.name}`,
    keywords: ["open", "open in"],
    icon: "external",
    run: () => {
      close();
      void openInCodingTool(tool, issue);
    },
  })),
});
