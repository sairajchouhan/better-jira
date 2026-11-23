import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const TLA_VERSION = "1.7.4";
const DEFAULT_JAR_PATHS = [
  process.env.TLA2TOOLS_JAR,
  join(process.env.HOME ?? "", `.local/share/mise/installs/http-tla2tools/${TLA_VERSION}/tla2tools.jar`),
  join(process.env.HOME ?? "", ".local/share/mise/installs/http-tla2tools/latest/tla2tools.jar"),
  join(ROOT, ".cache/tla2tools.jar"),
].filter((p): p is string => Boolean(p));

function findJar(): string {
  for (const candidate of DEFAULT_JAR_PATHS) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `tla2tools.jar (${TLA_VERSION}) not found. Set TLA2TOOLS_JAR or install http-tla2tools ${TLA_VERSION}.`,
  );
}

type ModelRun = {
  name: string;
  spec: string;
  config: string;
  brokenVariants: Array<{
    name: string;
    bugFlag: string;
    expectedInvariant: string;
    pastCommit: string;
  }>;
};

const MODELS: ModelRun[] = [
  {
    name: "sync_protocol",
    spec: join(ROOT, "specs/sync_protocol.tla"),
    config: join(ROOT, "specs/sync_protocol.cfg"),
    brokenVariants: [
      {
        name: "stale-read-overtakes-write",
        bugFlag: "BUG_STALE_READ",
        expectedInvariant: "NoStaleReadRegression",
        pastCommit: "a0a7477c",
      },
      {
        name: "takeover-overwrites-concurrent-edit",
        bugFlag: "BUG_TAKEOVER_OVERWRITE",
        expectedInvariant: "TakeoverKeepsConcurrentEdit",
        pastCommit: "ab2de404",
      },
      {
        name: "lost-answer-upload-refused",
        bugFlag: "BUG_LOST_UPLOAD_REFUSED",
        expectedInvariant: "LostAnswerNeverRefusedOrDuplicated",
        pastCommit: "83c69811",
      },
      {
        name: "cleaner-deletes-held-file",
        bugFlag: "BUG_CLEANER_DELETES_HELD",
        expectedInvariant: "CleanerNeverDeletesHeldFile",
        pastCommit: "88f44ba6",
      },
    ],
  },
  {
    name: "inbox_marks",
    spec: join(ROOT, "specs/inbox_marks.tla"),
    config: join(ROOT, "specs/inbox_marks.cfg"),
    brokenVariants: [
      {
        name: "no-answer-rolls-back-mark",
        bugFlag: "BUG_NO_ANSWER_ROLLS_BACK",
        expectedInvariant: "NoAnswerNeverDropsMark",
        pastCommit: "8a43e557",
      },
      {
        name: "undo-resurrects-stale-read-mark",
        bugFlag: "BUG_UNDO_RESTORES_READ",
        expectedInvariant: "NoStrandedReadMark",
        pastCommit: "6e330b6b",
      },
    ],
  },
];

function runTlc(jar: string, spec: string, config: string, workdir: string) {
  const localSpec = join(workdir, basename(spec));
  const localCfg = join(workdir, basename(config));
  if (spec !== localSpec) copyFileSync(spec, localSpec);
  if (config !== localCfg) copyFileSync(config, localCfg);
  const proc = Bun.spawnSync(
    [
      "java",
      "-XX:+UseParallelGC",
      "-cp",
      jar,
      "tlc2.TLC",
      "-workers",
      "1",
      "-cleanup",
      "-metadir",
      join(workdir, "states"),
      "-config",
      basename(localCfg),
      basename(localSpec),
    ],
    { stdout: "pipe", stderr: "pipe", cwd: workdir },
  );
  return {
    code: proc.exitCode,
    output: proc.stdout.toString() + proc.stderr.toString(),
  };
}

const proveBugs = process.argv.includes("--prove-bugs");
const jar = findJar();
const workdir = mkdtempSync(join(tmpdir(), "better-jira-tlc-"));

try {
  for (const model of MODELS) {
    const res = runTlc(jar, model.spec, model.config, workdir);
    const statesMatch = res.output.match(/(\d+) states generated, (\d+) distinct states found/);
    if (res.code !== 0) {
      console.error(`FAIL ${model.name} (exit ${res.code}):\n${res.output}`);
      process.exit(1);
    }
    console.log(
      `PASS ${model.name}: ${statesMatch ? `${statesMatch[2]} distinct states checked` : "ok"}`,
    );

    if (proveBugs) {
      const baseCfg = readFileSync(model.config, "utf8");
      for (const variant of model.brokenVariants) {
        const brokenCfgPath = join(workdir, `${model.name}_${variant.name}.cfg`);
        const brokenCfg = baseCfg.replace(
          new RegExp(`${variant.bugFlag}\\s*=\\s*FALSE`),
          `${variant.bugFlag} = TRUE`,
        );
        if (brokenCfg === baseCfg) {
          throw new Error(`Could not toggle ${variant.bugFlag} in ${model.config}`);
        }
        writeFileSync(brokenCfgPath, brokenCfg);
        const bad = runTlc(jar, model.spec, brokenCfgPath, workdir);
        if (bad.code === 0 || !bad.output.includes(`Invariant ${variant.expectedInvariant} is violated`)) {
          console.error(
            `FAIL red-proof ${model.name}/${variant.name} (commit ${variant.pastCommit}): expected ${variant.expectedInvariant} violation.\n${bad.output}`,
          );
          process.exit(1);
        }
        console.log(
          `PROVEN RED ${model.name}/${variant.name} (replays ${variant.pastCommit}): TLC caught ${variant.expectedInvariant}`,
        );
      }
    }
  }
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
