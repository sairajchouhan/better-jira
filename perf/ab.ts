// Interleaved, one-server-at-a-time read-only A/B driver. No app source edits.
const app = "/Users/sairaj.chouhan/.t3/worktrees/better-jira/t3-49468bd9-761e1bc0abda14bc";
const out = "/Users/sairaj.chouhan/cs/better-jira/.raj/qa/perf";
const env = { ...process.env, NODE_ENV: "production", JIRA_WRITES: "off" };
const resume = Bun.argv.includes("--resume");
const commands: string[] = resume ? await Bun.file(`${out}/compiler-commands.json`).json() : [];
for (const cpu of [1, 4])
  for (let block = 1; block <= 5; block++)
    for (const variant of ["A", "B"]) {
      const port = variant === "A" ? 3061 : 3062;
      const args = [
        "bun",
        "--env-file=.env",
        variant === "A" ? "src/index.ts" : "dist/app/index.js",
      ];
      const prefix = `${out}/compiler-${variant}-${cpu}x-block${block}`;
      if (resume && (await Bun.file(`${prefix}.json`).exists())) continue;
      console.log(`START ${variant} CPU ${cpu}x block ${block}/5`);
      commands.push(
        `cd ${app} && JIRA_WRITES=off NODE_ENV=production PORT=${port} ${args.join(" ")}`,
      );
      const log = Bun.file(`${prefix}-server.log`).writer();
      const server = Bun.spawn(args, {
        cwd: app,
        env: { ...env, PORT: String(port) },
        stdout: "pipe",
        stderr: "pipe",
      });
      const pump = async (stream: ReadableStream<Uint8Array>) => {
        for await (const chunk of stream) log.write(chunk);
      };
      const pumps = [pump(server.stdout), pump(server.stderr)];
      try {
        let ready = false;
        for (let n = 0; n < 120; n++) {
          try {
            const c = (await (await fetch(`http://localhost:${port}/api/client`)).json()) as any;
            if (c.writable !== false || new URL(c.site).hostname !== "contentstack.atlassian.net")
              throw Error("Unsafe server");
            ready = true;
            break;
          } catch (e) {
            if (String(e).includes("Unsafe")) throw e;
            await Bun.sleep(500);
          }
        }
        if (!ready) throw Error("Server failed to boot");
        const args2 = [
          "bun",
          "perf/vitals.ts",
          "--url",
          `http://localhost:${port}`,
          "--cpu",
          String(cpu),
          "--runs",
          "2",
          "--out",
          `${prefix}.json`,
        ];
        commands.push(args2.join(" "));
        const harness = Bun.spawn(args2, { stdout: "inherit", stderr: "inherit" });
        if ((await harness.exited) !== 0) throw Error("Harness failed");
      } finally {
        server.kill("SIGINT");
        await server.exited;
        await Promise.all(pumps);
        await log.end();
        await Bun.write(`${out}/compiler-commands.json`, JSON.stringify(commands, null, 2));
      }
    }
