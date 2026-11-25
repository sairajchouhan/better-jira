/**
 * Hands the boot shell (index.html #loading) over to the app, as Linear's loading-done observer (`E`, Root.DgAGfQ2G.js):
 * once #root holds the app and no element in it is marked `data-app-loading`, the shell fades out over 100ms (at once
 * after a reload that has not painted yet, Linear's `D`) and body gets `loaded`. Linear then sets display:none; this
 * removes the shell so nothing hidden stays in the page.
 */

/** Linear's handover fade (`n=D()?0:100`). */
export const HANDOVER_MS = 100;

/** The part of #root the handover reads. */
type Root = Pick<Element, "childElementCount" | "querySelector">;

/** Whether the app has painted something that no longer waits on its first data. */
export function appPainted(root: Root) {
  return root.childElementCount > 0 && !root.querySelector("[data-app-loading]");
}

/** Linear's `D`: a reload that has not painted anything yet swaps without the fade. */
export function firstPaintPending(perf: Pick<Performance, "getEntriesByType">) {
  const [navigation] = perf.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return navigation?.type === "reload" && perf.getEntriesByType("paint").length === 0;
}

type Environment = {
  document: Pick<Document, "getElementById" | "body">;
  performance: Pick<Performance, "getEntriesByType">;
  MutationObserver: typeof MutationObserver;
  setTimeout: (fn: () => void, ms: number) => unknown;
};

/** Watches #root and fades the boot shell out once the app has painted. Returns a function that stops watching. */
export function handOverBootShell(root: Root & Node, env: Environment = globalThis as unknown as Environment) {
  const shell = env.document.getElementById("loading");
  if (!shell) return () => {};
  const observer = new env.MutationObserver(() => {
    if (!appPainted(root)) return;
    observer.disconnect();
    const ms = firstPaintPending(env.performance) ? 0 : HANDOVER_MS;
    shell.style.transitionDuration = `${ms}ms`;
    env.document.body.classList.add("loaded");
    if (ms === 0) shell.remove();
    else env.setTimeout(() => shell.remove(), ms);
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-app-loading"] });
  return () => observer.disconnect();
}
