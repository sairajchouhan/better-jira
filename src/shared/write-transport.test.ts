import { expect, test } from "bun:test";
import { classifyWriteResponse, RETRY_STATUS, sendWriteRequest } from "./write-transport";
import { retryWriteResponse, writeJsonResponse } from "@/server/write-response";

test("server retry responses and 503 answers classify as no_answer, never refused", async () => {
  const fromRetryHelper = await classifyWriteResponse(retryWriteResponse(), "fallback");
  expect(fromRetryHelper).toEqual({
    kind: "no_answer",
    error: "Jira didn't answer.",
    status: RETRY_STATUS,
  });

  const fromWriteJson = await classifyWriteResponse(
    writeJsonResponse({ error: "Still settling", retry: true }),
    "fallback",
  );
  expect(fromWriteJson).toEqual({
    kind: "no_answer",
    error: "Still settling",
    status: RETRY_STATUS,
  });
});

test("network failures classify as unreachable and Jira 4xx/502 answers classify as refused", async () => {
  const boom = new TypeError("Failed to fetch");
  const unreachable = await sendWriteRequest("/api/inbox", { method: "POST" }, {
    fetchFn: (async () => {
      throw boom;
    }) as unknown as typeof fetch,
  });
  expect(unreachable).toEqual({
    kind: "unreachable",
    error: "Can't reach the better-jira server.",
    cause: boom,
  });

  const refused = await classifyWriteResponse(
    writeJsonResponse({ error: "Jira rejected the field" }, 422),
    "fallback",
  );
  expect(refused).toEqual({
    kind: "refused",
    error: "Jira rejected the field",
    data: { error: "Jira rejected the field" },
    status: 422,
  });

  const gatewayRefusal = await classifyWriteResponse(
    Response.json({ error: "Jira did not update the notification." }, { status: 502 }),
    "fallback",
  );
  expect(gatewayRefusal).toEqual({
    kind: "refused",
    error: "Jira did not update the notification.",
    data: { error: "Jira did not update the notification." },
    status: 502,
  });
});
