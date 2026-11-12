import type { ReactNode } from "react";
import { Button } from "./button";
import { Select } from "./select";
import { Switch } from "./switch";
import { Text } from "./text";

/** A display-options row: label on the left, Linear's compact Select on the right (Linear's Display menu). */
export function SelectRow({
  label,
  value,
  options,
  onChange,
  children,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-2">
      <Text variant="mini" color="muted">{label}</Text>
      <span className="flex w-[170px] items-center gap-2">
        {children}
        <Select label={label} size="compact" value={value} onValueChange={onChange} className="min-w-0 flex-1">
          {options.map(([v, l]) => (
            <Select.Option key={v} value={v}>
              {l}
            </Select.Option>
          ))}
        </Select>
      </span>
    </div>
  );
}

/** A display-options row: label on the left, a small Switch on the right. */
export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex min-h-8 cursor-default items-center justify-between gap-4">
      <Text variant="mini" color="muted">{label}</Text>
      <Switch size="small" aria-label={label} checked={value} onChange={onChange} />
    </label>
  );
}

/**
 * Linear's "Display properties" row (view options `Row column` > `Label $fullWidth` + `FieldOptions wrap` of
 * `SmallToggleButton`s): a miniPlus muted heading, then `jv` tab/small chips whose active fill is
 * controlSecondarySelected. Spacing is the bundle's: heading 8px above / 4px below, chips 8px under it, 1px gap plus
 * a 4px right/bottom margin each.
 */
export function DisplayProperties<Id extends string>({
  properties,
  shown,
  onChange,
}: {
  properties: readonly (readonly [Id, string])[];
  shown: readonly Id[];
  onChange: (shown: Id[]) => void;
}) {
  return (
    <div className="flex min-h-8 flex-col">
      <Text as="div" variant="miniPlus" color="muted" className="mt-2 mb-1 flex w-full items-center">
        Display properties
      </Text>
      <div className="mt-2 flex flex-wrap gap-px">
        {properties.map(([id, label]) => (
          <Button
            key={id}
            variant="tab"
            size="small"
            aria-pressed={shown.includes(id)}
            onClick={() => onChange(shown.includes(id) ? shown.filter((p) => p !== id) : [...shown, id])}
            className="mr-1 mb-1 aria-pressed:bg-sel"
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}
