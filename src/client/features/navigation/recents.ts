import { useEffect } from "react";
import { get, useStore } from "@/client/state/store";
import { readStored, writeStored } from "@/client/state/stored-state";

/** Linear's recency registry: issues opened and searches run in this browser, newest first, per Jira account. */
type Kind = "issues" | "searches";
const LIMIT: Record<Kind, number> = { issues: 20, searches: 5 };
const strings = (raw: unknown) =>
  Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
const storageKey = (kind: Kind) => `better-jira:recent-${kind}:v1:${get().namespace}`;
const read = (kind: Kind) => readStored(storageKey(kind), strings, []);
const push = (kind: Kind, value: string) =>
  writeStored(storageKey(kind), [value, ...read(kind).filter((v) => v !== value)].slice(0, LIMIT[kind]));

/** Issue keys, most recently opened first. */
export const recentIssues = () => read("issues");
export const recentSearches = () => read("searches");
export const recordSearch = (query: string) => {
  if (query.trim()) push("searches", query.trim());
};
/** Records every issue that opens, beside the board or as a page. */
export function useRecordVisits() {
  const open = useStore((s) => (s.panel ? s.selected : null));
  useEffect(() => {
    if (open) push("issues", open);
  }, [open]);
}
