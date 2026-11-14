import { Menu } from "@/client/components/menu";
import { usePristine } from "@/client/components/menu-pristine";
import type { OpenedBy } from "@/client/components/filter-block";
import { menuFilter } from "@/client/lib/fuzzy-score";

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
  const start = usePristine(openedBy === "pointer");
  return (
    <Menu filter={menuFilter} defaultValue={current} {...start.props}>
      <Menu.Input
        hideWhenEmpty
        autoFocus
        aria-label={`Filter ${name} operators`}
        placeholder={operators.find(([op]) => op === current)?.[1]}
        onValueChange={start.wake}
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
