import { Avatar } from "@/client/components/avatar";
import { HoverCard } from "@/client/components/hover-card";
import { TOOLTIP_TIMING } from "@/client/components/tooltip-rules";
import { personAt } from "@/client/features/navigation/app-navigation";
import { AppLink } from "@/client/features/navigation/app-link";
import { usePeople } from "@/client/state/store";
import type { User } from "@/shared/issue-model";

/** The person a mention names: the known person with its id (their photo and current name), else the mention's own text. */
export const mentionedUser = (people: readonly User[], id: string, label: string): User =>
  people.find((person) => person.id === id) ?? { id, name: label.replace(/^@/, "") };

/**
 * A person mentioned in a comment or description, as Linear's user mention in an issue (startup-root `att` → `dtt`): "@Name" in
 * labelTitle at weight 500 (600 inside a heading or bold, `sx-w8d4cr`), with no chip, background or pointer, and no click of its
 * own. Its card opens 450ms after the pointer reaches it, moves or not (the editor's `linkPopovers`, `HUn`), above it from its
 * start (`Aa`: a User popover is top-start). One control for the read-only document and the editor (`smartLinkNodeView`).
 */
export function UserMention({ id, label }: { id: string; label: string }) {
  return (
    <HoverCard
      label="User"
      display="inline"
      placement="top-start"
      timing={TOOLTIP_TIMING.documentPopover}
      // `HUn` opens a card only for a mention node with an id.
      isDisabled={!id}
      content={<UserCard id={id} label={label} />}
    >
      <span className="user-mention" data-mention-id={id}>
        {label}
      </span>
    </HoverCard>
  );
}

/**
 * Linear's user card (`ift` → `oft`): the header `hft` (`fft.topContainer`: a 10px-gap row, 4px padded, 180–380px wide) with the
 * person's 32px avatar and their name in smallPlus (13px) labelTitle at weight 500, a link to their page (`PA`, `linkToUserProfile`).
 * Linear's handle, presence, local time, teams and projects below it (`gft`) have nothing in Jira to show, so `gft` renders nothing,
 * as it does in Linear when a user has none of them.
 */
function UserCard({ id, label }: { id: string; label: string }) {
  const user = mentionedUser(usePeople(), id, label);
  return (
    <div className="flex min-w-[180px] max-w-[380px] items-center gap-2.5 p-1">
      <Avatar user={user} size={32} title={null} />
      <AppLink to={personAt(user.id)} className="truncate text-[13px] font-medium text-fg">
        {user.name}
      </AppLink>
    </div>
  );
}
