import { createContext, use, useId, useMemo, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

/**
 * The selection and keyboard model Tabs and SegmentedControl share: one selected value, roving tab stop, arrows wrap and
 * skip disabled tabs, Home/End jump to the ends. Selection follows keyboard focus.
 */
export function rovingIndex(
  key: string,
  current: number,
  disabled: readonly boolean[],
  orientation: "horizontal" | "vertical" = "horizontal",
): number | null {
  const count = disabled.length,
    [back, forward] = orientation === "horizontal" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"],
    walk = (from: number, step: 1 | -1) => {
      for (let i = 1; i <= count; i++) {
        const index = (((from + step * i) % count) + count) % count;
        if (!disabled[index]) return index;
      }
      return null;
    };
  if (!count) return null;
  if (key === forward) return walk(current, 1);
  if (key === back) return walk(current < 0 ? 0 : current, -1);
  if (key === "Home") return walk(-1, 1);
  if (key === "End") return walk(count, -1);
  return null;
}

type Tablist = {
  value: string;
  onValueChange: (value: string) => void;
  id: string;
};

const TablistContext = createContext<Tablist | null>(null);

export function TablistProvider({
  value,
  onValueChange,
  children,
}: Omit<Tablist, "id"> & { children: ReactNode }) {
  const id = useId(),
    context = useMemo(() => ({ value, onValueChange, id }), [value, onValueChange, id]);
  return <TablistContext value={context}>{children}</TablistContext>;
}

function useTablist() {
  const context = use(TablistContext);
  if (!context) throw new Error("A tab must sit inside its Tabs or SegmentedControl.");
  return context;
}

/** Props for the element holding the tabs. */
export function useTablistProps(orientation: "horizontal" | "vertical" = "horizontal") {
  return {
    role: "tablist",
    "aria-orientation": orientation,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')],
        next = rovingIndex(
          event.key,
          tabs.indexOf(document.activeElement as HTMLElement),
          tabs.map((tab) => tab.matches(':disabled, [aria-disabled="true"]')),
          orientation,
        );
      if (next === null) return;
      event.preventDefault();
      tabs[next]!.focus();
      tabs[next]!.click();
    },
  } as const;
}

/** Props for one tab; only the selected tab is in the page's tab order. */
export function useTabProps(value: string, onClick?: (event: MouseEvent<HTMLButtonElement>) => void) {
  const tablist = useTablist(),
    selected = tablist.value === value;
  return {
    type: "button",
    role: "tab",
    id: `${tablist.id}-tab-${value}`,
    "aria-selected": selected,
    "data-active": selected ? "" : undefined,
    tabIndex: selected ? 0 : -1,
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (!event.defaultPrevented) tablist.onValueChange(value);
    },
  } as const;
}

/** Props for the panel a tab shows. */
export function useTabPanelProps(value: string) {
  const tablist = useTablist();
  return {
    role: "tabpanel",
    "aria-labelledby": `${tablist.id}-tab-${value}`,
    hidden: tablist.value !== value,
  } as const;
}
