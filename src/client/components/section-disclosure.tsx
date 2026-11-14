import { use, type ReactNode } from "react";
import { Button, Disclosure, DisclosurePanel, DisclosureStateContext } from "react-aria-components";
import { Icon } from "./icons";

/**
 * A collapsible section: React Aria's `Disclosure`, so its toggle carries `aria-expanded` and `aria-controls` for the panel it
 * opens. The section owns where it keeps its state (`expanded` / `onExpandedChange`). The wrapper takes no box of its own
 * (`display: contents`), so the section's rows stay laid out as its siblings were before.
 *
 *   <SectionDisclosure expanded={…} onExpandedChange={…}>
 *     <SectionDisclosure.Trigger label="Sub-issues" />
 *     <SectionDisclosure.Panel>{rows}</SectionDisclosure.Panel>
 *   </SectionDisclosure>
 */
export function SectionDisclosure({
  expanded,
  onExpandedChange,
  children,
}: {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Disclosure isExpanded={expanded} onExpandedChange={onExpandedChange} className="contents">
      {children}
    </Disclosure>
  );
}

/**
 * Linear's issue section header button (IssueSectionComponents `f`: `Rlt` borderless, size medium, a miniPlus labelMuted
 * text; used for Sub-issues, Customers and Resources and the sidebar's sections): a 24px pill with a muted caret. It takes the
 * borderless look but none of its pressed fill, so an expanded section never looks selected. Geometry measured on RAJ-53:
 * caret 7px and label 24px in. React Aria's `Button slot="trigger"` toggles the section and names its panel.
 */
function SectionDisclosureTrigger({ label }: { label: string }) {
  const expanded = use(DisclosureStateContext)?.isExpanded ?? false;
  return (
    <Button
      slot="trigger"
      aria-label={`${expanded ? "Collapse" : "Expand"} ${label.toLowerCase()} section`}
      className="flex h-6 items-center gap-0.5 rounded-full pr-[13px] pl-1.5 text-[12px] font-medium text-fg-3 hover:bg-(--control-tertiary-hover)"
    >
      <span className={`grid size-4 place-items-center ${expanded ? "rotate-90" : ""}`}>
        <Icon name="chevron" size={14} />
      </span>
      <span>{label}</span>
    </Button>
  );
}

/**
 * The section's rows: React Aria's `DisclosurePanel` (the `aria-controls` target), boxless like its section. The rows mount only
 * while it is open, as Linear's sections do, so a collapsed section costs nothing to render.
 */
function SectionDisclosurePanel({ children }: { children: ReactNode }) {
  const expanded = use(DisclosureStateContext)?.isExpanded ?? false;
  return <DisclosurePanel className="contents">{expanded && children}</DisclosurePanel>;
}

SectionDisclosure.Trigger = SectionDisclosureTrigger;
SectionDisclosure.Panel = SectionDisclosurePanel;
