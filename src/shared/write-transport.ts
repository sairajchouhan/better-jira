export const RETRY_STATUS = 503 as const;

export type RetryBody = {
  error: string;
  retry: true;
};

export type WriteTransportOutcome<T> =
  | { kind: "ok"; data: T; status: number }
  | { kind: "unreachable"; error: string; cause: unknown }
  | { kind: "no_answer"; error: string; status: typeof RETRY_STATUS }
  | { kind: "refused"; error: string; data: T | null; status: number };

export function assertNever(value: never): never {
  throw new Error(`Unhandled write transport outcome: ${JSON.stringify(value)}`);
}

const errorText = (body: unknown): string | undefined =>
  body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string"
    ? (body as { error: string }).error
    : undefined;

const retryFlag = (body: unknown): boolean | undefined =>
  body && typeof body === "object" && "retry" in body && typeof (body as { retry?: unknown }).retry === "boolean"
    ? (body as { retry: boolean }).retry
    : undefined;

export async function classifyWriteResponse<T>(
  response: Response,
  fallbackError: string,
  noAnswerError = "Jira didn't answer.",
): Promise<WriteTransportOutcome<T>> {
  const data = (await response.json().catch(() => null)) as T | null;
  if (response.status === RETRY_STATUS && retryFlag(data) !== false) {
    return {
      kind: "no_answer",
      error: errorText(data) ?? noAnswerError,
      status: RETRY_STATUS,
    };
  }
  if (!response.ok) {
    return {
      kind: "refused",
      error: errorText(data) ?? fallbackError,
      data,
      status: response.status,
    };
  }
  return { kind: "ok", data: data as T, status: response.status };
}

export async function fetchWriteEndpoint(
  url: string,
  init: RequestInit,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  return fetchFn(url, init);
}

export async function sendWriteRequest<T>(
  url: string,
  init: RequestInit,
  options: {
    fallbackError?: string;
    fetchFn?: typeof fetch;
    ignoreUnreachable?: () => boolean;
  } = {},
): Promise<WriteTransportOutcome<T>> {
  const { fallbackError = "Jira refused", fetchFn = fetch, ignoreUnreachable } = options;
  let response: Response;
  try {
    response = await fetchWriteEndpoint(url, init, fetchFn);
  } catch (cause) {
    if (ignoreUnreachable?.()) return new Promise<never>(() => {});
    return {
      kind: "unreachable",
      error: "Can't reach the better-jira server.",
      cause,
    };
  }
  return classifyWriteResponse<T>(response, fallbackError);
}
