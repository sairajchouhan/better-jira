/**
 * The lazy screens' chunks. They are not walked themselves: tree.tsx files each route component's own `preload` in the
 * walk, which loads the chunk and also lets the component render without suspending.
 */
import { loadable } from "@/client/lib/loadable";

export const issueViewChunk = loadable("issue-view", () => import("./issue-view"), "skip");
export const inboxChunk = loadable("inbox", () => import("./inbox"), "skip");
/** The document screen, and the document opened inside an issue. */
export const issueDocumentChunk = loadable("issue-document", () => import("./issue-document"), "skip");
