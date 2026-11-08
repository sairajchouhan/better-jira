export type History = {
  created: string | number;
  items: { fieldId?: string; field?: string; from?: string | null; to?: string | null }[];
};

/** Jira's bulk history uses epoch milliseconds; individual history uses ISO strings. */
function timestamp(value: string | number): number {
  return typeof value === "number" ? (value < 1e11 ? value * 1000 : value) : Date.parse(value);
}

export function statusDates(
  created: string,
  current: string,
  histories: History[],
  categoryOf: (id: string) => string | undefined,
) {
  const changes = histories
    .flatMap((h) =>
      h.items
        .filter((i) => (i.fieldId === "status" || i.field === "status") && i.from !== i.to)
        .map((i) => ({ at: timestamp(h.created), from: i.from, to: i.to })),
    )
    .filter((c) => Number.isFinite(c.at))
    .sort((a, b) => a.at - b.at);
  const latest = changes.at(-1);
  const statusSince = !latest
    ? created
    : latest.to === current
      ? new Date(latest.at).toISOString()
      : undefined;
  const firstStarted = changes.find((c) => c.to && categoryOf(c.to) === "indeterminate");
  return {
    statusSince,
    started: firstStarted
      ? new Date(firstStarted.at).toISOString()
      : !changes.length && categoryOf(current) === "indeterminate"
        ? created
        : undefined,
  };
}

/** Unknown formats stay unknown. An empty development summary means Jira reports no linked PRs. */
export function pullRequestCount(value: unknown): number | undefined {
  let data: any = value;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      // The field can be a Java-map wrapper with a genuine JSON value under `json=`.
      const marker = data.indexOf("json=");
      if (marker < 0) return undefined;
      const raw = data.slice(marker + 5).trimStart();
      let depth = 0,
        quoted = false,
        escaped = false,
        end = -1;
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (quoted) {
          if (escaped) escaped = false;
          else if (c === "\\") escaped = true;
          else if (c === '"') quoted = false;
          continue;
        }
        if (c === '"') quoted = true;
        else if (c === "{") depth++;
        else if (c === "}" && --depth === 0) {
          end = i + 1;
          break;
        }
      }
      if (end < 0) return undefined;
      try {
        data = JSON.parse(raw.slice(0, end));
      } catch {
        return undefined;
      }
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  if (!Object.keys(data).length) return 0;
  const summary = data.cachedValue?.summary ?? data.summary;
  if (summary && typeof summary === "object" && !summary.pullrequest) return 0;
  const count = summary?.pullrequest?.overall?.count;
  return typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : undefined;
}
