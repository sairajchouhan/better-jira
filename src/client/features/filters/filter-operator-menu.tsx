import { Menu } from "@/client/components/menu";
import type { OpenedBy } from "@/client/components/filter-block";

/**
 * A FilterBlock's operator menu, for every filter bar: Linear's type-to-filter search hidden until typing, titled by the current
 * operator, the current one checked; pristine when a pointer opened it.
 */
export function FilterOperatorMenu<Op extends string>({
  name,
  current,
  operators,
  openedBy,
  pick,
}: {
  /** The field, for the search's accessible name: "Filter status operators". */
  name: string;
  current: Op;
  operators: [Op, string][];
  openedBy: OpenedBy;
  pick: (op: Op) => void;
}) {
  const pointer = openedBy === "pointer";
  return (
    <Menu defaultValue={pointer ? undefined : current} start={pointer ? "none" : "first"}>
      <Menu.Input
        hideWhenEmpty
        autoFocus
        aria-label={`Filter ${name} operators`}
        placeholder={operators.find(([op]) => op === current)?.[1]}
      />
      <Menu.List>
        <Menu.Empty>No matching operators</Menu.Empty>
        {operators.map(([op, label]) => (
          <Menu.Item key={op} value={op} keywords={[label]} checked={current === op} onSelect={() => pick(op)}>
            {label}
          </Menu.Item>
        ))}
      </Menu.List>
    </Menu>
  );
}
