import { expect, test } from "bun:test";
import { prepareOps, Unreachable, uploadNow, UploadRefused } from "./jira-media";

/** What `send` rejects with while the browser's fetch answers `answer`. */
async function failure(answer: () => Promise<Response>, send: () => Promise<unknown>) {
  const original = globalThis.fetch;
  globalThis.fetch = Object.assign(answer, original);
  try {
    return await send().then(
      () => undefined,
      (error: unknown) => error,
    );
  } finally {
    globalThis.fetch = original;
  }
}
const offline = async (): Promise<Response> => {
  throw new TypeError("Failed to fetch");
};

test("an upload fails as unreachable when the server can't be reached, and as refused when the server says no", async () => {
  const upload = () => uploadNow("KAN-1", [new File(["x"], "a.png")], async () => []);
  expect(await failure(offline, upload)).toBeInstanceOf(Unreachable);
  const refusal = async () => Response.json({ error: "The file is too large for Jira." }, { status: 422 });
  expect(await failure(refusal, upload)).toBeInstanceOf(UploadRefused);
});

test("removing a Jira attachment fails as unreachable when the server can't be reached to keep its copy, and otherwise not", async () => {
  const remove = () => prepareOps("KAN-1", [{ op: "attachment.delete", id: "10001" }]);
  expect(await failure(offline, remove)).toBeInstanceOf(Unreachable);
  const gone = await failure(async () => new Response("gone", { status: 404 }), remove);
  expect(gone).toBeInstanceOf(Error);
  expect(gone).not.toBeInstanceOf(Unreachable);
});
