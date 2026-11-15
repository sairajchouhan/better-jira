/** The parts of an `auxclick` a row reads: which button, where it landed, and the row it is on. */
type AuxClick = {
  button: number;
  target: EventTarget | null;
  currentTarget: { contains(node: Node | null): boolean };
  preventDefault(): void;
  stopPropagation(): void;
};

/**
 * Middle-click opens a row in a new tab, as Linear's rows do. Linear's list rows are real links (ListCell.D_3tVWEf.js: `linkForItem`,
 * the row rendered with `to:`), and its Button takes the same gesture by hand (startup-root.BhUCnb9L.js `kv`:
 * `i.button===1&&r?(i.preventDefault(),i.stopPropagation(),e.disabled||r(i))`). Ours can't be links: a card or row is React
 * Aria's GridList row (a `div` that has no link of its own, and React Aria has no middle-click on rows) and holds links and buttons
 * an `<a>` couldn't wrap. So the row takes the middle button's `auxclick` as Linear's Button does, and leaves ⌘-click, the left
 * button and a link inside it (which opens its own address) to what handles them now. A click from a portal (a menu the row
 * opened) isn't the row's.
 */
export function openInNewTabOnMiddleClick(url: () => string, open: (url: string) => void = openTab) {
  return (event: AuxClick) => {
    if (event.button !== 1) return;
    const target = event.target as Element | null;
    if (!target || !event.currentTarget.contains(target)) return;
    const inner = target.closest?.('a[href], [role="dialog"]');
    if (inner && event.currentTarget.contains(inner)) return;
    event.preventDefault();
    event.stopPropagation();
    open(url());
  };
}

const openTab = (url: string) => void window.open(url, "_blank", "noopener");
