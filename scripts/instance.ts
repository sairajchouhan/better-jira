/** Runs one copy of better-jira: `bun scripts/instance.ts <start|dev|setup> <name|path> [setup args]`.
 *  An instance is a folder holding everything one Jira site and account needs: `.env` (credentials), `settings.json`
 *  (site, boards, the edits switch) and `cache.db`. A name is `instances/<name>`; anything with a `/` is a folder path.
 *  `start` builds the instance to `dist/<folder name>` and runs it in production; `dev` runs it with hot reload; `setup`
 *  makes the folder and connects it to Jira. Only the instance's `.env` is loaded (bunfig.toml turns off bun's own
 *  `.env` loading), and the shell's env still beats it, so `PORT=3031 bun start personal` moves the port. `BETTER_JIRA_DIST`
 *  moves the build, so a second copy of an instance doesn't overwrite the one already running. */
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const COMMANDS = ["start", "dev", "setup"] as const;
type Command = (typeof COMMANDS)[number];

const [command, target, ...rest] = process.argv.slice(2);
const root = path.resolve(import.meta.dir, "..");
const instances = path.join(root, "instances");
const names = (() => {
  try {
    return readdirSync(instances, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
})();
const isFolder = (folder: string) => statSync(folder, { throwIfNoEntry: false })?.isDirectory() ?? false;

function fail(problem: string): never {
  console.error(
    `${problem}\n\nUsage: bun start <name>, bun run dev <name>, bun run setup <name>, where <name> is a folder in instances/ or a path to one.\n` +
      (names.length
        ? `Instances: ${names.join(", ")}`
        : "No instances yet: bun run setup <name> makes instances/<name> and connects it to your Jira."),
  );
  process.exit(1);
}

if (!COMMANDS.includes(command as Command)) fail(`Unknown command "${command ?? ""}".`);
if (!target) fail("Name the instance to run.");
const home = target.includes("/")
  ? path.resolve(target)
  : /^\w[\w.-]*$/.test(target)
    ? path.join(instances, target)
    : fail(`"${target}" isn't an instance name: use letters, digits, ".", "-" and "_".`);
if (command === "setup") mkdirSync(home, { recursive: true });
else if (!isFolder(home)) fail(`There is no instance at ${path.relative(root, home) || home}.`);

const credentialsFile = existsSync(path.join(home, "credentials.env"))
  ? path.join(home, "credentials.env")
  : path.join(home, ".env");
const envFile = `--env-file=${credentialsFile}`;
const env = { ...process.env, BETTER_JIRA_HOME: home };
const out = process.env.BETTER_JIRA_DIST || path.join("dist", path.basename(home));

/** Runs `args` from the repo root, passing Ctrl+C and kill on to it; resolves to its exit code. */
async function run(args: string[], extra: Record<string, string> = {}) {
  const child = Bun.spawn(args, { cwd: root, env: { ...env, ...extra }, stdio: ["inherit", "inherit", "inherit"] });
  const forward = (signal: NodeJS.Signals) => child.kill(signal);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, forward);
  return child.exited;
}

const code =
  command === "start"
    ? (await run([process.execPath, "scripts/build-server.ts", "src/server/index.ts", out])) ||
      (await run([process.execPath, envFile, path.join(out, "index.js")], { NODE_ENV: "production" }))
    : command === "dev"
      ? await run([process.execPath, envFile, "--hot", "src/server/index.ts"])
      : await run([process.execPath, envFile, "scripts/setup.ts", ...rest]);
process.exit(code);
