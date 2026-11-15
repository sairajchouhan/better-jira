/** The lazy screens, as loadables: the idle walk fetches them, and a hover or the route fetches the same promise. */
import { loadable, ROUTE_ORDER } from "@/client/lib/loadable";

/** The issue side panel and page. First in the walk with the editor, where they were fetched at the first idle before. */
export const issueViewChunk = loadable("issue-view", () => import("./issue-view"), 10);
export const inboxChunk = loadable("inbox", () => import("./inbox"), ROUTE_ORDER);
/** The document screen, and the document opened inside an issue. */
export const issueDocumentChunk = loadable("issue-document", () => import("./issue-document"), ROUTE_ORDER);
