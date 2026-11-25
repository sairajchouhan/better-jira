import { mkdirSync } from "node:fs";
import pkg from "../../package.json";
import { loadCredentialsEnv, readSavedPort, resolveInstancePaths } from "./env";

export const CLI_VERSION = pkg.version;
export const DEFAULT_PORT = 4747;

export type CliCommand = "start" | "status" | "open" | "help" | "version";

export type ParsedCli = {
  command: CliCommand;
  instance: string;
  port?: number;
  home?: string;
  noOpen: boolean;
};

export type ProbeResult =
  | { status: "ready"; site: string; userName: string; writable: boolean }
  | { status: "setup"; site: string }
  | { status: "other" }
  | { status: "down" };

const COMMANDS = new Set<CliCommand>(["start", "status", "open", "help", "version"]);

/** Parses CLI arguments for the standalone `better-jira` binary. */
export function parseCliArgs(argv: readonly string[]): ParsedCli {
  let command: CliCommand | null = null;
  let instance = "default";
  let port: number | undefined;
  let home: string | undefined;
  let noOpen = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") return { command: "help", instance, noOpen };
    if (arg === "-v" || arg === "--version") return { command: "version", instance, noOpen };
    if (arg === "--no-open") {
      noOpen = true;
      continue;
    }
    if (arg === "-i" || arg === "--instance") {
      const value = argv[++i];
      if (!value) throw new Error("--instance requires a name.");
      instance = value;
      continue;
    }
    if (arg.startsWith("--instance=")) {
      instance = arg.slice("--instance=".length);
      continue;
    }
    if (arg === "-p" || arg === "--port") {
      const value = Number(argv[++i]);
      if (!Number.isSafeInteger(value) || value < 1 || value > 65535) {
        throw new Error("--port must be a number between 1 and 65535.");
      }
      port = value;
      continue;
    }
    if (arg.startsWith("--port=")) {
      const value = Number(arg.slice("--port=".length));
      if (!Number.isSafeInteger(value) || value < 1 || value > 65535) {
        throw new Error("--port must be a number between 1 and 65535.");
      }
      port = value;
      continue;
    }
    if (arg === "--home") {
      const value = argv[++i];
      if (!value) throw new Error("--home requires a directory path.");
      home = value;
      continue;
    }
    if (arg.startsWith("--home=")) {
      home = arg.slice("--home=".length);
      continue;
    }
    if (!arg.startsWith("-") && !command) {
      if (!COMMANDS.has(arg as CliCommand)) {
        throw new Error(`Unknown command "${arg}". Run "better-jira --help" for usage.`);
      }
      command = arg as CliCommand;
      continue;
    }
    throw new Error(`Unknown option "${arg}". Run "better-jira --help" for usage.`);
  }

  return { command: command ?? "start", instance, port, home, noOpen };
}

function usage(): string {
  return `better-jira v${CLI_VERSION} — Linear-speed UI for Jira Cloud

Usage:
  better-jira [command] [options]

Commands:
  start       Start better-jira and open it in your browser (default)
  status      Show whether better-jira is running and where its config lives
  open        Open better-jira in your default browser

Options:
  -i, --instance <name>   Instance name under ~/.config/better-jira/instances/ (default: default)
  -p, --port <port>       Local port to listen on (default: ${DEFAULT_PORT})
  --home <dir>            Explicit instance directory (overrides --instance)
  --no-open               Do not open the browser automatically
  -v, --version           Print version
  -h, --help              Show this help
`;
}

function resolvePort(parsed: ParsedCli, instanceDir: string): number {
  if (parsed.port) return parsed.port;
  const envPort = Number(process.env.PORT);
  if (Number.isSafeInteger(envPort) && envPort >= 1 && envPort <= 65535) return envPort;
  return readSavedPort(instanceDir) ?? DEFAULT_PORT;
}

/** Probes `127.0.0.1:<port>/api/client` to tell running better-jira, setup mode, another process, and stopped apart. */
export async function probeServer(port: number): Promise<ProbeResult> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/client`, {
      signal: AbortSignal.timeout(1500),
    });
    const text = await response.text();
    try {
      const data = JSON.parse(text) as {
        needsSetup?: boolean;
        site?: string;
        user?: { id?: string; name?: string };
        writable?: boolean;
        error?: string;
      };
      if (data.needsSetup === true) return { status: "setup", site: data.site ?? "" };
      if (typeof data.site === "string" && data.user?.name) {
        return { status: "ready", site: data.site, userName: data.user.name, writable: Boolean(data.writable) };
      }
      if (response.status === 503 && typeof data.error === "string") {
        return { status: "ready", site: "", userName: "", writable: false };
      }
    } catch {}
    return { status: "other" };
  } catch {
    return { status: "down" };
  }
}

function openBrowser(url: string) {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "linux"
        ? ["xdg-open", url]
        : null;
  if (!cmd) return;
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).unref();
  } catch {}
}

async function main() {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.command === "help") {
    console.log(usage());
    return;
  }
  if (parsed.command === "version") {
    console.log(`better-jira v${CLI_VERSION}`);
    return;
  }

  const paths = resolveInstancePaths({ instance: parsed.instance, home: parsed.home });
  const port = resolvePort(parsed, paths.instanceDir);
  const url = `http://127.0.0.1:${port}`;

  if (parsed.command === "open") {
    const probe = await probeServer(port);
    if (probe.status === "down") {
      console.error(`better-jira is not running on ${url}. Start it with: better-jira`);
      process.exit(1);
    }
    openBrowser(url);
    console.log(`Opened ${url}`);
    return;
  }

  if (parsed.command === "status") {
    const probe = await probeServer(port);
    console.log(`Instance:    ${paths.instance}`);
    console.log(`URL:         ${url}`);
    console.log(`Config dir:  ${paths.instanceDir}`);
    console.log(`Cache dir:   ${paths.cacheDir}`);
    console.log(`Credentials: ${paths.credentialsFile}`);
    if (probe.status === "ready") {
      const who = probe.userName ? ` as ${probe.userName}` : "";
      const site = probe.site ? ` (${new URL(probe.site).host})` : "";
      console.log(`Status:      running${site}${who}`);
    } else if (probe.status === "setup") {
      console.log(`Status:      running (waiting for browser setup at ${url})`);
    } else if (probe.status === "other") {
      console.log(`Status:      port ${port} is held by another process`);
    } else {
      console.log(`Status:      stopped`);
    }
    return;
  }

  // `start` (default): run directly in the foreground; Ctrl+C stops it cleanly.
  const existing = await probeServer(port);
  if (existing.status === "ready" || existing.status === "setup") {
    console.log(
      existing.status === "setup"
        ? `better-jira is already waiting for setup on ${url}`
        : `better-jira is already running on ${url}`,
    );
    if (!parsed.noOpen) openBrowser(url);
    return;
  }
  if (existing.status === "other") {
    console.error(
      `Port ${port} is already in use by another process.\nRun on another port: better-jira --port ${port + 1}`,
    );
    process.exit(1);
  }

  mkdirSync(paths.instanceDir, { recursive: true });
  mkdirSync(paths.cacheDir, { recursive: true });
  process.env.BETTER_JIRA_HOME = paths.instanceDir;
  process.env.PORT = String(port);
  process.env.NODE_ENV = "production";
  if (!process.env.JIRA_CACHE) process.env.JIRA_CACHE = paths.cacheFile;
  if (!process.env.JIRA_TRIPS) process.env.JIRA_TRIPS = paths.tripsFile;
  loadCredentialsEnv(paths.instanceDir, process.env);

  const { startServer } = await import("../server/start");
  const server = await startServer();
  console.log(`Config: ${paths.instanceDir}`);
  console.log(`Cache:  ${paths.cacheDir}`);
  if (!parsed.noOpen) openBrowser(server.url.toString());
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
