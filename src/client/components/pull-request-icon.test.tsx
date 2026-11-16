import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { PullRequestBadge, PullRequestCard, PullRequestsCardContent } from "@/client/features/issue/card-badges";
import { IssuePullRequestRow } from "@/client/features/issue/issue-pull-requests";
import type { Issue } from "@/shared/issue-model";
import type { PullRequest } from "@/shared/pull-requests";
import { PullRequestStatusIcon } from "./icons";

/**
 * Pull request state icons follow GitHub, not Linear (the user's choice, 2026-11-17): Primer Octicons 19.42.0 16px paths
 * (`@primer/octicons` build/data.json) in Primer Primitives 11.10.0's fgColor-open/-draft/-done/-closed, light and dark.
 */
const OCTICONS = {
  "git-pull-request":
    "M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z",
  "git-pull-request-draft":
    "M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 14a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM14 7.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm0-4.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z",
  "git-merge":
    "M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z",
  "git-pull-request-closed":
    "M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-2.03-5.273a.75.75 0 0 1 1.06 0l.97.97.97-.97a.748.748 0 0 1 1.265.332.75.75 0 0 1-.205.729l-.97.97.97.97a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-.97-.97-.97.97a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l.97-.97-.97-.97a.75.75 0 0 1 0-1.06ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z",
};

/** Each state's Octicon and colour token; open, in review and approved are all GitHub's open PR, Jira's declined its closed. */
const EXPECTED: Record<PullRequest["status"], [keyof typeof OCTICONS, string]> = {
  open: ["git-pull-request", "--github-pr-open"],
  inReview: ["git-pull-request", "--github-pr-open"],
  approved: ["git-pull-request", "--github-pr-open"],
  draft: ["git-pull-request-draft", "--github-pr-draft"],
  merged: ["git-merge", "--github-pr-merged"],
  declined: ["git-pull-request-closed", "--github-pr-closed"],
};

const paths = (html: string) => [...html.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);

test("each pull request state draws GitHub's Octicon in its Primer colour token", () => {
  for (const [status, [octicon, token]] of Object.entries(EXPECTED)) {
    const html = renderToStaticMarkup(<PullRequestStatusIcon status={status as PullRequest["status"]} />);
    expect(paths(html)).toEqual([OCTICONS[octicon]]);
    expect(html).toContain(`fill="var(${token})"`);
    expect(html).toContain(`data-octicon="${octicon}"`);
    expect(html).toContain('viewBox="0 0 16 16"');
  }
});

test("a pull request with no state yet draws the open Octicon in labelBase", () => {
  const html = renderToStaticMarkup(<PullRequestStatusIcon />);
  expect(paths(html)).toEqual([OCTICONS["git-pull-request"]]);
  expect(html).toContain('fill="var(--fg-2)"');
});

/** The `--github-pr-*` values control-tokens.css sets on `:root`, outside or inside the dark scheme block. */
async function githubTokens() {
  const css = (await Bun.file(new URL("./control-tokens.css", import.meta.url)).text()).replace(/\/\*[\s\S]*?\*\//g, "");
  const out = { light: {} as Record<string, string>, dark: {} as Record<string, string> };
  const dark = /@media \(prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}/g;
  for (const m of css.matchAll(dark)) for (const [, k, v] of m[1]!.matchAll(/(--github-pr-[\w-]+):\s*([^;]+);/g)) out.dark[k!] = v!.trim();
  for (const [, k, v] of css.replace(dark, "").matchAll(/(--github-pr-[\w-]+):\s*([^;]+);/g)) out.light[k!] = v!.trim();
  return out;
}

test("the colours are Primer's fgColor open, draft, done and closed for light and dark", async () => {
  expect(await githubTokens()).toEqual({
    light: { "--github-pr-open": "#1a7f37", "--github-pr-draft": "#59636e", "--github-pr-merged": "#8250df", "--github-pr-closed": "#d1242f" },
    dark: { "--github-pr-open": "#3fb950", "--github-pr-draft": "#9198a1", "--github-pr-merged": "#ab7df8", "--github-pr-closed": "#f85149" },
  });
});

/** Every client source file, for the checks that no surface draws its own pull request icon. */
function clientSources(dir = new URL("../", import.meta.url).pathname): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) return clientSources(`${path}/`);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

test("every pull request surface draws the one shared icon, and nothing else carries a pull request shape", async () => {
  const sources = await Promise.all(clientSources().map(async (path) => [path, await Bun.file(path).text()] as const));
  // The card and row badge, its hover card and list, the "Go to linked pull request…" menu, and the issue's Diffs rows.
  for (const surface of ["features/issue/card-badges.tsx", "features/issue/issue-pull-requests.tsx"]) {
    const [, text] = sources.find(([path]) => path.endsWith(surface))!;
    expect(text).toContain("<PullRequestStatusIcon");
  }
  const shapes = Object.values(OCTICONS).map((d) => d.slice(0, 40));
  const owners = sources.filter(([, text]) => shapes.some((shape) => text.includes(shape))).map(([path]) => path);
  expect(owners.map((path) => path.split("/client/")[1])).toEqual(["components/icons.tsx"]);
  // No surface paints a pull request state with Linear's or its own colour beside the shared icon.
  const stray = sources.filter(([path, text]) => !path.endsWith("icons.tsx") && /data-pr-status|--github-pr-/.test(text));
  expect(stray.map(([path]) => path)).toEqual([]);
});

const pr = (n: number, status: PullRequest["status"]): PullRequest => ({
  url: `https://github.com/acme/widgets/pull/${n}`,
  title: `Change ${n}`,
  number: `#${n}`,
  status,
});
/** Each icon a rendered surface draws, as its Octicon and fill. */
const icons = (html: string) => [...html.matchAll(/fill="([^"]+)"[^>]*data-octicon="([^"]+)"/g)].map((m) => `${m[2]} ${m[1]}`);

test("the PR hover card, its list of several and the issue's Diffs row draw GitHub's icon and colour", () => {
  expect(icons(renderToStaticMarkup(<PullRequestCard pr={pr(1, "merged")} />))).toEqual(["git-merge var(--github-pr-merged)"]);
  expect(icons(renderToStaticMarkup(<PullRequestsCardContent prs={[pr(1, "merged"), pr(2, "open"), pr(3, "declined")]} />))).toEqual([
    "git-merge var(--github-pr-merged)",
    "git-pull-request var(--github-pr-open)",
    "git-pull-request-closed var(--github-pr-closed)",
  ]);
  expect(icons(renderToStaticMarkup(<IssuePullRequestRow pr={pr(4, "merged")} />))).toEqual(["git-merge var(--github-pr-merged)"]);
  expect(icons(renderToStaticMarkup(<IssuePullRequestRow pr={pr(5, "draft")} />))).toEqual(["git-pull-request-draft var(--github-pr-draft)"]);
});

test("the card's \"7 PRs\" badge draws the issue's leading state as GitHub's icon: all merged is GitHub's purple git-merge", () => {
  const badge = (prStatus: PullRequest["status"]) =>
    icons(renderToStaticMarkup(<PullRequestBadge issue={{ key: "ACME-1", prCount: 7, prStatus } as Issue} layout="board" />));
  expect(badge("merged")).toEqual(["git-merge var(--github-pr-merged)"]);
  expect(badge("open")).toEqual(["git-pull-request var(--github-pr-open)"]);
  expect(badge("declined")).toEqual(["git-pull-request-closed var(--github-pr-closed)"]);
});
