# Round 2 Package F (performance)

Measured with `E2E_PORT_BASE=5200 bun perf/large-board.ts`. It uses the production React Compiler fixture build, Chromium at 1440×900, three fresh contexts, and 2,000 bulk issues per board plus the six standard ones. "Before" is 1e6a75f, the tip before this package. Each cell is the median of three runs; the spread is in brackets.

## BJ-110: lazy editor and chrono (done)

| Initial JS gzip (scripts fetched by 1 s after the board is ready) | Before | After |
|---|---:|---:|
| Every run | 466,976 bytes | 372,183 bytes |

That is 94,793 bytes less, or 20.3%. Chrono was already behind dynamic imports, from the due-date and reminder menus. The saving is the ProseMirror editor chunk, which was fetched on idle at startup.

- **When it loads.** An issue or inbox URL fetches it at boot, because its first screen shows an editor. Elsewhere it loads on the first pointer over an issue card or the first key press.
- **While it loads.** A read-only ADF stand-in shows the document. Nothing says "Loading editor…".
- **No lost input.** The stand-in takes focus, the characters typed and ⌘↵. The editor then continues from them: caret at the end, the text inserted, then a save if ⌘↵ was pressed.
- **No id on the stand-in.** Focus commands and anchors still wait for the real editor, as they did before.

## BJ-111: windowed boards and lists (done)

| | Before | After |
|---|---:|---:|
| Board: mounted cards | 2,006 | 46 |
| Board: DOM elements | 56,460 | 1,574 |
| List: mounted rows | 2,006 | 21 |
| List: DOM elements | 49,081 | 753 |
| ⌘B board→list interaction (Event Timing, key to next paint) | 64 ms [64–72] | 24 ms [24–48] |
| Long tasks during the switch | 0 ms [0–56] | 0 ms in every run |
| Scroll frame p95, quiet machine | 16.8 ms | 16.7 ms |
| Scroll frame p95, loaded machine (`before-loaded.json`) | 33.4 ms | 16.7 ms |
| R1-D95/D96: cards in the layout switch's first commit (96 issues) | 75 (wip) | 20 |

Scroll p95 is capped by vsync on a quiet machine. Under load the old 50k-node DOM dropped to 30 fps; the windowed DOM stayed at 60.

`VirtualItems` (src/virtual-items.tsx) is hand-rolled and adds no dependency. It sits in the existing scroll containers: one per list group and lane, one per board column or swimlane cell.

- It mounts nothing until its first layout effect has measured the viewport. That runs before paint, so nothing flashes, and many groups no longer multiply a guessed 900 px window.
- It windows short groups too. The wip rendered every group of 20 items or fewer in full, which accounted for 73 of its 75 first-paint rows.
- The selected, focused and dragged items always stay mounted, in DOM order:
  - selection scroll-into-view and issue-menu anchors (`issueAnchor`) always find the selected item;
  - focus and Tab are kept;
  - a drag source survives scrolling.

  A selection made off-window is scrolled to again once it takes its measured place. This replaced the wip's separate selection-scroll math.
- It re-measures on every render, on scroll, and when the scroller or a sibling group, lane or column resizes.

Checked against the brief:
- **j/k and selection.** These run on store order (`visibleOrder`), not on the DOM.
- **Drag and drop.** Drops read only the cards rendered around the drop point, which are always mounted. A new e2e covers a drop into a scrolled column.
- **Find in view and copy.** Both read the store, not rendered `[data-key]`.
- **DOM scans.** The only other `[data-key]` scan in src is `issueAnchor`, and the selected item stays mounted for it.

## Tests

- `e2e/performance-r2.pw.ts`
  - Text typed while the editor chunk is held reaches the focused editor.
  - j/k makes 80 presses across 15 lanes and the selection stays in view.
  - A drop into a scrolled column.
  - The scroll-to-end check now scrolls again until the windows catch up, since measured cards can outgrow the estimate.
  - The first two fail on the wip.
- `e2e/pending-send.pw.ts` P4 checked that a new issue "joins the board" by finding its card in the hidden board's DOM. Windowing changes that on purpose, so it now waits for the issue page's "n / total" to go up by one.
