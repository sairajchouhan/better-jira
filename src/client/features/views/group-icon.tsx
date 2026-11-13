import { Icon, PriorityIcon, StatusIcon } from "@/client/components/icons";
import type { Bucket, Grouping } from "@/shared/view-model";

/** A group's icon wherever a group is named (column heading, hidden columns, Group ordering): its status, its priority,
 *  else the layers glyph. */
export function GroupIcon({ bucket, by }: { bucket: Bucket; by: Grouping }) {
  if (bucket.status) return <StatusIcon status={bucket.status} />;
  if (by === "priority") return <PriorityIcon name={bucket.name} />;
  return <Icon name="layers" />;
}
