import type { AdfDocument, AdfNode } from "@/shared/document";

// Keep the replaced content until Jira accepts or refuses its create. Restoration addresses the reference,
// so subsequent edits elsewhere in the source description survive a refused create.
const selections = new Map<string, { source: string; url: string; content: AdfNode[] }>();
export function rememberSelectionCreate(key: string, source: string, url: string, content: AdfNode[]) {
  selections.set(key, { source, url, content });
}
export function forgetSelectionCreate(key: string) { selections.delete(key); }
export function refusedSelectionCreate(key: string) {
  const selection = selections.get(key);
  selections.delete(key);
  if (!selection) return;
  const restore = (node: AdfNode): AdfNode => ({
    ...node,
    ...(node.content ? { content: node.content.flatMap(child =>
      child.type === "inlineCard" && child.attrs?.url === selection.url
        ? selection.content
        : [restore(child)],
    ) } : {}),
  });
  return { source: selection.source, restore: (doc: AdfDocument) => restore(doc) as AdfDocument };
}
