/**
 * Linear's board split panel widths (IssueList `Df`, limits from the split-view state `lr`, setting from UserSettings):
 * the panel is at least 480px, the board beside it keeps at least 640px, and a container too narrow for both
 * (under 1120px) gets the panel over the whole page with no resize handle. The saved width defaults to 760 and is
 * clamped during render, so a smaller window narrows the panel without rewriting what was saved.
 */
export const SPLIT_PANEL = { minWidth: 480, minViewWidth: 640, defaultWidth: 760 } as const;

export type SplitPanelLayout = { fillsPage: boolean; width: number; min: number; max: number };

/** `pageFitsBesideView`, then `A = max(minWidth, T − minViewWidth)` and `j = fills ? T : min(max(saved, minWidth), A)`. */
export function splitPanelLayout(containerWidth: number, saved: number): SplitPanelLayout {
  const { minWidth, minViewWidth } = SPLIT_PANEL;
  const fillsPage = containerWidth < minWidth + minViewWidth;
  const max = Math.max(minWidth, containerWidth - minViewWidth);
  return { fillsPage, width: fillsPage ? containerWidth : Math.min(Math.max(saved, minWidth), max), min: minWidth, max };
}

/**
 * `boardSplitPanelWidth` is a browserSession user setting (persistence 2): each write goes to this tab's sessionStorage
 * and to localStorage as the default a new tab starts from; a read prefers the tab's own value.
 */
const KEY = "better-jira:boardSplitPanelWidth";

export function readSplitPanelWidth(): number {
  try {
    const value = Number(sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY));
    return value > 0 ? value : SPLIT_PANEL.defaultWidth;
  } catch {
    return SPLIT_PANEL.defaultWidth;
  }
}

export function writeSplitPanelWidth(width: number) {
  try {
    sessionStorage.setItem(KEY, String(width));
    localStorage.setItem(KEY, String(width));
  } catch {
    // Storage off: the width still holds for this mount.
  }
}
