import { type Board, type Issue, type IssueDraft } from "@/shared/issue-model";
import { ME } from "@/client/state/store";
import { documentHasMedia, normalizeDocument, type AdfDocument } from "@/shared/document";
import { adfToText } from "@/client/features/editor/adf";


export type SubIssueDraft = {
  title: string;
  description: AdfDocument;
  files: NonNullable<Issue["attachments"]>;
  properties: IssueDraft;
};
/**
 * A new sub-issue's properties. Linear's `Issue.create` with a parent sets `priority = priority || parent.priority`
 * (startup-entry `w2.create`, `ye.priority=s||f.priority`), so the inline composer starts at the parent's priority
 * (R3-create-D10); the project is the parent's (`createSubIssue`: `project:n.project?.value`).
 */
export const subIssueDefaults = (parent: Issue, board: Board): IssueDraft => ({
  parent: parent.key,
  project: parent.project,
  assignee: ME,
  priority: parent.priority,
  status:
    board.columns
      .find((c) => !/backlog/i.test(c.name) && c.statuses.some((s) => s.category === "new"))
      ?.statuses.find((s) => s.category === "new")?.id ?? board.columns[0]?.statuses[0]?.id,
  labels: [],
});
export const emptySubIssueDraft = (properties: IssueDraft): SubIssueDraft => ({
  title: "",
  description: normalizeDocument(""),
  files: [],
  properties,
});
export function readSubIssueDraft(key: string, initial: IssueDraft): SubIssueDraft {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!value || typeof value.title !== "string") return emptySubIssueDraft(initial);
    const properties: IssueDraft = { ...initial },
      saved = value.properties;
    if (saved && typeof saved === "object") {
      if (typeof saved.status === "string") properties.status = saved.status;
      if (typeof saved.priority === "string") properties.priority = saved.priority;
      if (saved.due === null || (typeof saved.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(saved.due))) properties.due = saved.due;
      if (
        saved.assignee === null ||
        (saved.assignee &&
          typeof saved.assignee.id === "string" &&
          typeof saved.assignee.name === "string")
      )
        properties.assignee = saved.assignee;
      if (
        Array.isArray(saved.labels) &&
        saved.labels.every((label: unknown) => typeof label === "string")
      )
        properties.labels = saved.labels;
    }
    const files = Array.isArray(value.files)
      ? value.files
          .filter(
            (file: any) =>
              file &&
              typeof file.id === "string" &&
              typeof file.name === "string" &&
              typeof file.type === "string" &&
              Number.isFinite(file.size),
          )
          .map((file: any) => ({
            id: file.id,
            name: file.name,
            type: file.type,
            size: file.size,
            url: "",
          }))
      : [];
    return {
      title: value.title,
      description: normalizeDocument(value.description),
      files,
      properties,
    };
  } catch {
    return emptySubIssueDraft(initial);
  }
}
export function saveSubIssueDraft(key: string, value: SubIssueDraft) {
  const hasContent =
    !!value.title ||
    !!adfToText(value.description).trim() ||
    documentHasMedia(value.description) ||
    value.files.length;
  if (hasContent)
    localStorage.setItem(
      key,
      JSON.stringify({ ...value, files: value.files.map(({ url, ...file }) => file) }),
    );
  else localStorage.removeItem(key);
}
