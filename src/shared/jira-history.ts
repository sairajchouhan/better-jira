/** One Jira changelog entry as the server hands it to the client: who, when, and what changed. */
export type HistoryActor = { id: string; name: string; avatar?: string; /** An app (automation, an integration, an agent), not a person. */ app?: boolean };
/** One changed field. `from`/`to` are Jira's raw values (ids, keys, dates); the `…Text` sides its display text (Jira's
 *  fromString/toString, renamed so an absent one never reads as `Object.prototype.toString`).
 *  Jira leaves a side null when there was no value; document fields (environment, comments) carry "" instead of their text,
 *  and the description carries its whole text (for its history). */
export type HistoryItem = {
  field: string;
  fieldId?: string;
  custom?: boolean;
  from: string | null;
  fromText: string | null;
  to: string | null;
  toText: string | null;
};
export type HistoryEntry = { id: string; at: string; actor: HistoryActor | null; items: HistoryItem[] };
