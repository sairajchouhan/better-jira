import { createInterface } from "node:readline/promises";
import { chmod } from "node:fs/promises";
import type { LocalSettings } from "../src/server/config";
import { runSetup } from "./setup-flow";

const settingsPath = ".better-jira.local.json";
const local: LocalSettings = await Bun.file(settingsPath)
  .json()
  .catch(() => ({}));
if (process.argv.includes("--help")) {
  console.log(
    "bun run setup          Connect better-jira to your Jira Cloud site, account and boards\nbun run setup --check  Check the saved setup against Jira (reads only, changes nothing)\n\nEnvironment: JIRA_URL, JIRA_EMAIL, JIRA_TOKEN, JIRA_BOARDS, JIRA_CACHE, PORT.\nSite and boards go in .better-jira.local.json; the email and token go in .env. Git ignores both.",
  );
  process.exit(0);
}
async function ask(label: string, existing = "") {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await terminal.question(`${label}${existing ? ` [${existing}]` : ""}: `)).trim();
    return answer || existing;
  } finally {
    terminal.close();
  }
}
/** The token, typed without echo. */
async function secret(saved: string): Promise<string> {
  process.stdout.write(`Jira API token${saved ? " [Enter keeps the saved token]" : ""}: `);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      process.stdin.off("data", read);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value || saved);
    };
    const read = (chunk: Buffer) => {
      for (const char of chunk.toString()) {
        if (char === "\u0003") {
          finish(new Error("Setup cancelled"));
          return;
        }
        if (char === "\r" || char === "\n") {
          finish();
          return;
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    };
    process.stdin.on("data", read);
  });
}
/** Credentials replace their old lines in .env (other lines stay); the file is the owner's alone. */
async function save(credentials: { email: string; token: string }, settings: LocalSettings) {
  const previous = await Bun.file(".env")
    .text()
    .catch(() => "");
  const retained = previous
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:export\s+)?JIRA_(?:EMAIL|TOKEN|URL|BOARDS)\s*=/.test(line))
    .join("\n")
    .trimEnd();
  await Bun.write(
    ".env",
    `${retained}${retained ? "\n" : ""}JIRA_EMAIL=${JSON.stringify(credentials.email)}\nJIRA_TOKEN=${JSON.stringify(credentials.token)}\n`,
  );
  await chmod(".env", 0o600);
  await Bun.write(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}
const checking = process.argv.includes("--check");
try {
  // Answers come from a person at a terminal; piped input would leave a question waiting forever.
  if (!checking && !process.stdin.isTTY)
    throw new Error(
      "bun run setup asks questions, so run it in a terminal. Or set JIRA_URL, JIRA_EMAIL, JIRA_TOKEN and JIRA_BOARDS in .env and run bun run setup --check.",
    );
  await runSetup(checking, process.env, local, {
    fetch: (url, init) => fetch(url, init),
    ask,
    secret,
    log: (line) => console.log(line),
    save,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Setup failed");
  process.exitCode = 1;
}
