import { createServer } from "node:net";
import { expect, startFixture, test } from "./app";

// Ports above the workers' 3200 + index range.
test("a fixture launch fails on an occupied port instead of testing the old server", async () => {
  const squatter = createServer().listen(3290, "127.0.0.1");
  await new Promise((r) => squatter.once("listening", r));
  const { child, ready } = startFixture(3290);
  await expect(ready).rejects.toThrow("exited");
  child.kill();
  squatter.close();
});

test("a fixture server exits when its runner goes away (stdin closes), even if the runner was killed", async () => {
  const { child, ready } = startFixture(3291);
  await ready;
  const exited = new Promise((r) => child.once("exit", r));
  child.stdin!.end(); // what the OS does to the pipe when the runner dies
  await exited;
  await expect(fetch("http://127.0.0.1:3291/")).rejects.toThrow();
});
