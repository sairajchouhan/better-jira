import { type Full, type Issue } from "@/shared/issue-model";
import { ME, get, set, statusOf } from "@/client/state/store";
import { issueURL } from "./issue-urls";
import { loadFull } from "@/client/state/server-data";
import { isLocalIssue } from "@/client/state/local-edits";
import { showNotification, type Notification } from "@/client/state/app-notifications";
import type { AdfNode } from "@/client/features/editor/rich-document";
import { canCopyRich, copyLinkedTexts, copyText, copyTextAsync, formatLinkedText, linkedTextsMarkdown } from "@/client/lib/clipboard";
import { modifiers } from "@/client/lib/modifier-keys";

const escape = (text: string) => text.replace(/[\\`*_[\]<>]/g, "\\$&");
const destination = (url: string) =>
  url.replace(/[\s()<>]/g, (char) =>
    encodeURIComponent(char).replace(/\(/g, "%28").replace(/\)/g, "%29"),
  );
export function adfToMarkdown(node: AdfNode | string | null | undefined): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  const attrs = node.attrs ?? {},
    children = node.content ?? [],
    inline = () => children.map(adfToMarkdown).join("");
  if (node.type === "text") {
    let text = escape(node.text ?? "");
    for (const mark of node.marks ?? [])
      switch (mark.type) {
        case "strong":
          text = `**${text}**`;
          break;
        case "em":
          text = `_${text}_`;
          break;
        case "strike":
          text = `~~${text}~~`;
          break;
        case "code": {
          const ticks = "`".repeat(
            Math.max(1, ...(node.text?.match(/`+/g) ?? []).map((s) => s.length + 1)),
          );
          text = `${ticks}${node.text?.startsWith("`") ? " " : ""}${node.text ?? ""}${node.text?.endsWith("`") ? " " : ""}${ticks}`;
          break;
        }
        case "link":
          text = `[${text}](${destination(String(mark.attrs?.href ?? ""))})`;
      }
    return text;
  }
  switch (node.type) {
    case "doc":
      return children.map(adfToMarkdown).join("\n\n");
    case "paragraph":
      return inline();
    case "heading":
      return `${"#".repeat(Math.max(1, Math.min(6, Number(attrs.level) || 2)))} ${inline()}`;
    case "hardBreak":
      return "  \n";
    case "bulletList":
    case "orderedList":
      return children
        .map((child, index) => {
          const prefix =
            node.type === "orderedList" ? `${index + (Number(attrs.order) || 1)}. ` : "- ";
          return adfToMarkdown(child)
            .split("\n")
            .map((line, i) => (i ? " ".repeat(prefix.length) : prefix) + line)
            .join("\n");
        })
        .join("\n");
    case "listItem":
      return children.map(adfToMarkdown).join("\n\n");
    case "taskList":
      return children.map(adfToMarkdown).join("\n");
    case "taskItem":
      return `- [${attrs.state === "DONE" ? "x" : " "}] ${inline()}`;
    case "codeBlock": {
      const raw = children.map((child) => child.text ?? "").join(""),
        fence = "`".repeat(Math.max(3, ...(raw.match(/`+/g) ?? []).map((s) => s.length + 1)));
      return `${fence}${String(attrs.language ?? "").replace(/[\r\n]/g, "")}\n${raw}\n${fence}`;
    }
    case "blockquote":
      return children
        .map(adfToMarkdown)
        .join("\n\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "rule":
      return "---";
    case "expand":
    case "nestedExpand":
      return `<details><summary>${escape(String(attrs.title ?? ""))}</summary>\n\n${children.map(adfToMarkdown).join("\n\n")}\n\n</details>`;
    case "mention":
    case "status":
    case "emoji":
      return String(attrs.text ?? attrs.shortName ?? "");
    case "inlineCard":
    case "blockCard":
      return String(attrs.url ?? "");
    case "table":
      return children
        .map((row, index) => {
          const cells = (row.content ?? []).map((cell) =>
            adfToMarkdown(cell).replaceAll("|", "\\|").replaceAll("\n", "<br>"),
          );
          return `| ${cells.join(" | ")} |${index === 0 ? `\n| ${cells.map(() => "---").join(" | ")} |` : ""}`;
        })
        .join("\n");
    case "tableHeader":
    case "tableCell":
      return children.map(adfToMarkdown).join("\n");
    case "media":
      return "[Jira attachment]";
    default:
      return inline();
  }
}
export const copyKinds = [
  "ID",
  "URL",
  "title",
  "title as link",
  "issue as Markdown",
  "everything as Markdown",
  "git branch name",
  // Linear's wX, after the branch in its Copy submenu (TX).
  "as prompt",
] as const;
export type CopyKind = (typeof copyKinds)[number];
/** Linear's Copy submenu icon and shortcut per kind, shared by the issue and sub-issue row menus. */
export const copyIcons = {
  ID: "copy",
  URL: "link",
  title: "pencil",
  "title as link": "link",
  "issue as Markdown": "file",
  "everything as Markdown": "file",
  "git branch name": "branch",
  "as prompt": "clipboard",
} as const;
export const copyShortcuts: Partial<Record<CopyKind, string>> = {
  ID: "copy-id",
  URL: "copy-url",
  title: "copy-title",
  "title as link": "copy-link",
  "everything as Markdown": "copy-markdown",
  "git branch name": "copy-branch",
  "as prompt": "copy-prompt",
};
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
/** Linear's default prompt template (`DAt` in startup-root.CnUSfl4j.js, with the suggested branch name on), naming Jira. */
export const PROMPT_TEMPLATE = "Work on Jira issue {{issue.identifier}}:\n\nSuggested branch name: {{issue.branchName}}\n\n{{context}}";
/** Linear's `AAt`: the template with each known placeholder replaced, an unknown value by nothing. */
export const fillPrompt = (values: { "issue.identifier": string; "issue.branchName": string; context: string }, template = PROMPT_TEMPLATE) =>
  template.replace(/\{\{(issue\.identifier|issue\.branchName|context)\}\}/g, (_, key: keyof typeof values) => values[key] ?? "");
/** `user` prefixes the git branch name like Linear's `raj/drft-53-title`. */
export function issueCopy(
  kind: CopyKind,
  issue: Issue,
  full: Full | undefined,
  url: string,
  status: string,
  user = "",
): string {
  const title = `${issue.key} ${issue.summary}`;
  switch (kind) {
    case "ID":
      return issue.key;
    case "URL":
      return url;
    case "title":
      // Linear `sM` with getModelIdentifier: "KEY: title" (⌥ copies the title without the ID).
      return `${issue.key}: ${issue.summary}`;
    case "title as link":
      // Linear's `uM`: the Markdown half of the link it copies (the HTML half is `linkedTextsHTML`).
      return linkedTextsMarkdown([formatLinkedText(issue.summary, issue.key)], [url])!;
    case "git branch name": {
      const owner = slug(user.split(/\s+/)[0] ?? "");
      return `${owner ? `${owner}/` : ""}${issue.key.toLowerCase()}-${slug(issue.summary)}`;
    }
    case "as prompt":
      // Linear fills its template from the server's issuePromptContext; ours is the issue as Copy everything as Markdown copies it.
      return fillPrompt({
        "issue.identifier": issue.key,
        "issue.branchName": issueCopy("git branch name", issue, full, url, status, user),
        context: issueCopy("everything as Markdown", issue, full, url, status, user),
      });
    default: {
      const description = adfToMarkdown(full?.fields.description ?? issue.description);
      const base = `# ${escape(title)}\n\n${description}`;
      if (kind === "issue as Markdown") return base;
      const comments = (full?.fields.comment?.comments ?? [])
        .map((c: any) => `${escape(c.author?.displayName ?? "Unknown")}: ${adfToMarkdown(c.body)}`)
        .join("\n\n");
      return `${base}\n\nStatus: ${status}\nAssignee: ${issue.assignee?.name ?? "Unassigned"}\nPriority: ${issue.priority ?? "None"}\nLabels: ${issue.labels.join(", ")}\n${issue.due ? `Due date: ${issue.due}\n` : ""}\n${comments}`;
    }
  }
}
/** Linear's info toast per copy action (startup-root bundle): `zmt` Copy ID, `sM` title, `uM` title as link, `lM`
 *  Markdown with `getModelTitle: identifier`, and the branch action (`QFn`) titled with the branch name. */
export function copyToast(kind: CopyKind, issue: Pick<Issue, "key">, copied: string): Notification {
  switch (kind) {
    case "ID":
    case "title":
      return { text: `"${copied}" copied to clipboard` };
    case "URL":
      return { text: "Copied issue link to clipboard", icon: "copy" };
    case "title as link":
      return { text: "Issue title copied to clipboard" };
    case "issue as Markdown":
      return { text: `Issue "${issue.key}" description copied to clipboard` };
    case "everything as Markdown":
      return { text: `Issue "${issue.key}" content copied to clipboard` };
    case "as prompt":
      // Linear's wX: an info toast with the copy icon.
      return { text: "Prompt copied to clipboard", icon: "copy" };
    case "git branch name":
      return {
        text: copied,
        detail: "Branch name copied to clipboard. Paste it into your favorite git client.",
      };
  }
}
/** Linear's Copy page URL (⌘⇧C) toast. */
export const PAGE_URL_COPIED: Notification = { text: "Current URL copied to clipboard" };
/** Kinds whose text needs the full issue (its comments), loaded first. */
const needsFull = (kind: CopyKind) => kind === "everything as Markdown" || kind === "as prompt";
/** Linear's ⌥ Copy ID toast (`Rmt`): `${Model} ${pluralize("ID")} copied to clipboard`. */
export const ID_LINK_COPIED: Notification = { text: "Issue ID copied to clipboard" };
/**
 * Copies one projection of the issue and confirms it with Linear's toast. `url` is the issue's link unless the caller has a
 * better one (an inbox notification's). Title as link, and Copy ID with ⌥ held, copy a link as HTML and Markdown at once.
 * Kinds that load the comments start the write inside the click and fill it in when the load ends (Linear's `copyTextAsync`).
 */
export async function copyIssue(kind: CopyKind, issue: Issue, url = issueURL(issue)) {
  if (kind === "URL") return copyIssueLink(url);
  try {
    if (kind === "ID" && modifiers.altKey && canCopyRich()) {
      await copyLinkedTexts([issue.key], [url]);
      return showNotification(ID_LINK_COPIED);
    }
    if (kind === "title as link") {
      await copyLinkedTexts([formatLinkedText(issue.summary, issue.key)], [url]);
      return showNotification(copyToast(kind, issue, ""));
    }
    if (needsFull(kind)) {
      // Linear toasts once the write settles, whether or not a newer copy superseded it.
      await copyTextAsync(issueText(kind, issue, url));
      return showNotification(copyToast(kind, issue, ""));
    }
    const text = textOf(kind, issue, url);
    await copyText(text);
    showNotification(copyToast(kind, issue, text));
  } catch {
    set({ perf: "Could not access the clipboard" });
  }
}

/** Copies one projection of an issue's document. Title as link copies HTML and Markdown at once, as Linear's `uM` does for a
 *  document (no identifier). */
export function copyDocument(kind: "url" | "title" | "link" | "markdown", doc: { title: string; url: string; markdown: () => string }) {
  if (kind === "link") return copyLinkedTexts([formatLinkedText(doc.title)], [doc.url]);
  return copyText(kind === "url" ? doc.url : kind === "title" ? doc.title : doc.markdown());
}

const textOf = (kind: CopyKind, issue: Issue, url: string) =>
  issueCopy(kind, issue, get().full.get(issue.key), url, statusOf(issue)?.name ?? issue.status, ME.name);

/** One projection of the issue as copied; the full issue (comments) is loaded first for the kinds that include it. */
export async function issueText(kind: CopyKind, issue: Issue, url = issueURL(issue)): Promise<string> {
  if (needsFull(kind) && !get().full.has(issue.key) && !isLocalIssue(issue.key)) {
    await loadFull(issue.key);
    if (!get().full.has(issue.key)) throw new Error("Issue details unavailable");
  }
  return textOf(kind, issue, url);
}

/** The same URL clipboard feedback for mirrored and cross-project relation rows. */
export async function copyIssueLink(url: string) {
  try {
    await copyText(url);
    // Linear's Copy URL action: an info toast with the copy icon (`Copied ${model} link to clipboard`).
    showNotification(copyToast("URL", { key: "" }, url));
  } catch {
    set({ perf: "Could not access the clipboard" });
  }
}
