import { afterAll, expect, test } from "bun:test";
import { open, stop } from "./harness";
afterAll(stop);
test("a second harness fails on an occupied fixture port instead of testing the old server", async () => {
  const page = await open();
  try {
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `const h=await import('./e2e/harness');try{const p=await h.open();await p.close();h.stop();process.exit(0)}catch(error){h.stop();console.error(error.message);process.exit(3)}`,
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    const [code, err] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(code).toBe(3);
    expect(err).toContain("E2E fixture port");
    expect(await page.eval(`!!document.querySelector('[data-key]')`)).toBe(true);
  } finally {
    await page.close();
  }
});

test("a killed test process leaves no fixture server or browser behind, even before its parent reaps it", async () => {
  const port = Number(process.env.E2E_PORT ?? 3011) + 1,
    listening = async () => {
      try {
        await fetch(`http://127.0.0.1:${port}/api/boards`);
        return true;
      } catch {
        return false;
      }
    };
  // Python never waits for its child, like a runner whose output capture is still open, so the killed bun stays an unreaped zombie.
  const child = `const h=await import('./e2e/harness');await h.open();console.log('ready');await new Promise(()=>{})`;
  const runner = Bun.spawn(
    [
      "python3",
      "-c",
      "import subprocess,sys,time;p=subprocess.Popen(sys.argv[1:]);print(p.pid,flush=True);time.sleep(30)",
      process.execPath,
      "-e",
      child,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, E2E_PORT: String(port) },
      stdout: "pipe",
      stderr: "ignore",
    },
  );
  const reader = runner.stdout.getReader();
  let text = "";
  while (!text.includes("ready")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  const pid = Number(text.split("\n")[0]);
  expect(await listening()).toBe(true);
  process.kill(pid, "SIGKILL");
  let gone = false;
  for (let i = 0; i < 50 && !gone; i++) {
    await Bun.sleep(100);
    gone = !(await listening());
  }
  runner.kill();
  expect(gone).toBe(true);
}, 30000);
