import { RETRY_STATUS, type RetryBody } from "@/shared/write-transport";

export function retryWriteResponse(error = "Jira didn't answer."): Response {
  const body: RetryBody = { error, retry: true };
  return Response.json(body, { status: RETRY_STATUS });
}

export function writeJsonResponse<T extends { error?: string; retry?: boolean }>(
  result: T,
  refusedStatus = 422,
): Response {
  return Response.json(result, {
    status: result.retry ? RETRY_STATUS : result.error ? refusedStatus : 200,
  });
}
