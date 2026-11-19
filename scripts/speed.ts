/** `bun run speed [port] [--runs N] [--status KEY]`: times the app's core actions on a running copy (default :3054), inside the
 *  page (e2e/speed.ts), in headless Chromium at 1440×900, and prints the median and p95 of each.
 *
 *  Read-only except `--status KEY`, which changes KEY's status and puts it back on every run; it needs a writable copy.
 *  Opening an issue marks its notifications read in Jira, so this refuses a copy on work Jira (contentstack.atlassian.net). */
import { chromium } from "@playwright/test";
import {
  changeStatus,
  coldOpen,
  openBoard,
  openIssue,
  percentile,
  readDataset,
  search,
  speedTimer,
  stepIssues,
  switchBoards,
} from "../e2e/speed";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args.splice(i, 2)[1];
};
const runs = Number(flag("--runs") ?? 10);
const statusKey = flag("--status");
const port = Number(args[0] ?? 3054);
const base = `http://localhost:${port}`;

const client = (await (await fetch(`${base}/api/client`)).json()) as { site: string; writable: boolean };
const site = new URL(client.site).hostname;
if (port === 3000 || site === "contentstack.atlassian.net")
  throw new Error(`refusing: :${port} is on ${site}. Opening an issue there marks its notifications read in work Jira.`);
if (statusKey && !client.writable) throw new Error(`--status needs a writable copy; :${port} can't write to Jira`);

const data = await readDataset(base);
const [boardA, boardB] = data.boards;
if (!boardA) throw new Error(`:${port} has no boards`);
console.log(`speed: ${base} on ${site}, ${data.total} issues on ${data.boards.length} boards, ${runs} runs per action`);

const browser = await chromium.launch();
const results: [string, number[]][] = [];
try {
  const { cold, reopen } = await coldOpen(browser, base, boardA.id, runs);
  results.push(["Cold open to a usable board (fresh browser)", cold], ["Reopen (reload, data and HTTP cache kept)", reopen]);

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(speedTimer);
  await openBoard(page, base, boardA.id);
  results.push(["Open an issue from the board", await openIssue(page, data, runs)]);
  results.push(["Next / previous issue (J / K)", await stepIssues(page, data, runs)]);
  if (boardB) results.push(["Switch board", await switchBoards(page, data, runs, boardA.id, boardB.id)]);
  results.push(["Search: last keystroke to results", await search(page, data, runs)]);
  if (statusKey) {
    const { shown, saved } = await changeStatus(page, statusKey, runs);
    results.push([`Change status (${statusKey}): shown`, shown], [`Change status (${statusKey}): Jira answered`, saved]);
  } else console.log("speed: status change skipped (pass --status KEY on a writable copy)");
  await context.close();
} finally {
  await browser.close();
}

const ms = (x: number) => `${Math.round(x)} ms`.padStart(8);
console.log(`\n${"Action".padEnd(48)}${"median".padStart(8)}${"p95".padStart(8)}${"min".padStart(8)}${"max".padStart(8)}   n`);
for (const [name, xs] of results)
  console.log(
    `${name.padEnd(48)}${ms(percentile(xs, 0.5))}${ms(percentile(xs, 0.95))}${ms(Math.min(...xs))}${ms(Math.max(...xs))}   ${xs.length}`,
  );
console.log(`\n${data.total} issues. With 20 runs or fewer, p95 is the slowest run.`);
