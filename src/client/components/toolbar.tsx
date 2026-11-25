import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode, Ref } from "react";
import { Toolbar as AriaToolbar } from "react-aria-components";

/** Linear's `Mze`: where an arrow, Home or End moves focus among `count` items from `at`. Both arrows wrap. */
export function nextToolbarIndex(key: string, at: number, count: number): number | undefined {
  if (count === 0 || at < 0) return undefined;
  switch (key) {
    case "ArrowRight":
      return (at + 1) % count;
    case "ArrowLeft":
      return (at - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return undefined;
  }
}

/** `jze`: keys a toolbar keeps from moving the text caret of an editor around it, whether or not focus moved. */
const CARET_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);
const ITEMS = "button:not(:disabled), a[href]";

/**
 * `Mx.handleToolbarKeyDown`: the arrows (wrapping), Home and End move focus among the toolbar's visible items; the other caret
 * keys are swallowed so an editor around the toolbar doesn't move its caret. Events from portals (an open menu) are left alone.
 * It runs as the key bubbles, so an item that takes an arrow itself (a menu trigger) keeps it.
 */
function handleToolbarKey(event: KeyboardEvent<HTMLElement>) {
  const target = event.target;
  if (event.defaultPrevented || !(target instanceof Node) || !event.currentTarget.contains(target)) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(ITEMS)].filter((item) => item.getClientRects().length);
  const next = nextToolbarIndex(
    event.key,
    items.findIndex((item) => item.contains(target)),
    items.length,
  );
  if (next !== undefined) items[next]!.focus();
  else if (!CARET_KEYS.has(event.key)) return;
  event.preventDefault();
}

type ToolbarProps = {
  label: string;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLDivElement>;
  onMouseDown?: (event: MouseEvent<HTMLElement>) => void;
  children: ReactNode;
};

/**
 * A horizontal row of controls (Linear's `Px`): React Aria's `Toolbar`, so it is one Tab stop (Tab leaves it, and coming back
 * lands on the item last focused) and names itself `role="toolbar"`, or `group` inside another toolbar. Its arrow keys are
 * Linear's (`Mx`), which wrap and take Home and End where React Aria's stop at the ends, and run as the key bubbles where React
 * Aria's run as it is captured (before the item could take it). So React Aria's capture handler gets only Tab.
 */
export function Toolbar(props: ToolbarProps) {
  return <ToolbarRoot element="div" {...props} />;
}

/**
 * The same toolbar as a `<span>`, for one that sits inside a paragraph (an inline file's node toolbar), where a `<div>` is
 * invalid. React Aria renders it through `render`; in development it warns that it expected a `<div>`, which is harmless here:
 * its toolbar behaviour doesn't depend on the element.
 */
export function InlineToolbar(props: ToolbarProps) {
  return <ToolbarRoot element="span" {...props} />;
}

function ToolbarRoot({ element: Element, label, ...props }: ToolbarProps & { element: "div" | "span" }) {
  return (
    <AriaToolbar
      aria-label={label}
      orientation="horizontal"
      {...props}
      render={({ onKeyDownCapture, ref, ...domProps }) => (
        <Element
          {...domProps}
          ref={ref as never}
          onKeyDownCapture={(event: KeyboardEvent<HTMLDivElement & HTMLSpanElement>) => {
            if (event.key === "Tab") onKeyDownCapture?.(event);
          }}
          onKeyDown={handleToolbarKey}
        />
      )}
    />
  );
}
