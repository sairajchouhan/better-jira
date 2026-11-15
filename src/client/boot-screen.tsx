import type { ReactNode } from "react";
import { Text } from "@/client/components/text";

/** The splash's mark (index.html #loading-logo), so a load that can't finish keeps the boot look. */
function BootMark() {
  return (
    <svg aria-hidden width="32" height="32" viewBox="0 0 16 16" className="fill-fg-4">
      <path d="M8 1A7 7 0 1 0 15 8H8Z" />
      <rect x="10" y="1" width="5" height="5" rx="1.25" />
    </svg>
  );
}

/**
 * What the app shows instead of the boot shell when its first load can't finish: Linear's bootstrap error screen (`Y`,
 * LoadApplicationLayout.C6gKgsF9.js): a centred column, the logo 32px above a title (title2, labelTitle) and the reason
 * (regular, labelMuted) 16px apart, then the buttons 40px below. It stays up through every retry until the app loads,
 * so the page is never blank (BJ-277). `role` is "alert" for an error, "status" for a wait.
 */
export function BootScreen({
  role,
  title,
  children,
  actions,
}: {
  role: "alert" | "status";
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div role={role} data-boot-screen className="flex h-screen flex-col items-center justify-center bg-app px-4">
      <div className="flex max-w-[440px] flex-col items-center gap-10 text-center">
        <div className="flex flex-col items-center gap-8">
          <BootMark />
          <div className="flex flex-col items-center gap-4">
            <Text as="h1" variant="title2" color="title">
              {title}
            </Text>
            {children}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
