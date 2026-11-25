import { Icon } from "@/client/components/icons";
import { Text } from "@/client/components/text";
import { fullTime } from "@/client/features/issue/issue-dates";
import { snoozedFor, unsnoozedAgo } from "@/shared/time-options";

/** Linear's snooze row on a snoozed notification (`showsSnoozeRow`, `notificationSnoozeRow`): "Snoozed for 2d" on a 22px third
 *  line, the exact time in its tooltip. */
export function SnoozedLine({ until, now }: { until: number; now: number }) {
  return (
    <span data-inbox-snoozed className="flex h-[22px] items-end">
      <Text variant="mini" color="muted" title={fullTime(new Date(until).toISOString())}>
        {snoozedFor(until, now)}
      </Text>
    </span>
  );
}

/** Linear's mark on an unread row back from snooze: a 14px muted clock before the time, "Unsnoozed 2h" as its tooltip. */
export function UnsnoozedMark({ at, now }: { at: number; now: number }) {
  const label = unsnoozedAgo(at, now);
  return (
    <span role="img" aria-label={label} title={label} data-inbox-unsnoozed className="grid place-items-center text-fg-3">
      <Icon name="clock" size={14} />
    </span>
  );
}
