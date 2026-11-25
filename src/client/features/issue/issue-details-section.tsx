import type { ReactNode } from "react";
import { ExpandChevrons } from "@/client/components/icons";
import { PropertyTrigger } from "@/client/components/property-trigger";
import { Text } from "@/client/components/text";

/** Linear's issue sidebar section (IssueDetailsSection.B1Ar3tsW.js `p`): a muted smallPlus heading, 8px in, over its rows 4px apart. */
export function IssueDetailsSection({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section className="flex flex-col items-start gap-1 [&+section]:mt-[33px]">
      <Text as="h3" variant="smallPlus" color="muted" className="mb-1.5 px-2">
        {name}
      </Text>
      {children}
    </section>
  );
}

/** Linear's "Show N more" under a sidebar list (IssueDetailsComponents.ve4guUwI.js `p`): a muted DetailButton, 6px below the rows,
 *  with the expand chevrons before its label. The label is the caller's: "Show 2 more" / "Show less", "3 closed" / "Hide closed". */
export function ShowMoreToggle({ expanded, onToggle, children }: { expanded: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="mt-1.5 flex max-w-fit items-center gap-1.5">
      <PropertyTrigger state="empty" aria-expanded={expanded} onClick={onToggle} data-show-more>
        <PropertyTrigger.Icon>
          <ExpandChevrons expanded={expanded} />
        </PropertyTrigger.Icon>
        <PropertyTrigger.Label>{children}</PropertyTrigger.Label>
      </PropertyTrigger>
    </div>
  );
}
