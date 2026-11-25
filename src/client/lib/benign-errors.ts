/**
 * Browser reports that are not failures. "ResizeObserver loop …" only says some resize notifications wait for the next
 * frame (popups that measure and reposition themselves before paint cause it); it is not an exception, but Bun's dev
 * error overlay treated it as one and blocked every click until dismissed (R3-create-D12, R3-relations-D9).
 */
export function isBenignError(message: unknown): boolean {
  return typeof message === "string" && message.startsWith("ResizeObserver loop");
}

/** Stops benign reports before other `error` listeners (the dev overlay) see them. */
export function ignoreBenignErrors(target: Pick<Window, "addEventListener">) {
  target.addEventListener(
    "error",
    (event) => {
      if (isBenignError(event.message)) event.stopImmediatePropagation();
    },
    true,
  );
}
