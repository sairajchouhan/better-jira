import type { ComponentProps, ReactNode } from "react";
import { Button, IconButton } from "./button";
import { Select } from "./select";
import { Switch } from "./switch";
import { Tabs } from "./tabs";
import { Text } from "./text";
import "./display-options.css";

/**
 * Linear's ViewOptions parts (the `qxr` namespace in startup-root.CnUSfl4j.js, styles `D4`, CSS module `_1koer_`).
 * Every view-options panel (board Display options, sub-issues, inbox) is built from these, so a section, row,
 * label, select, chip or footer looks the same wherever it renders. display-options.css spells the values out.
 */

/** `Exr` Container: 300 wide, 8px above the first section, whose top border it drops. Spread the popup's props on it. */
function Container({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`ui-vo ${className}`} {...props} />;
}

/** `Dxr` Content: one section, 8px 16px, divided from the one above by a thinPixel bgBorderFaintThin line. */
function Content(props: Omit<ComponentProps<"div">, "className">) {
  return <div className="ui-vo-content" {...props} />;
}

/** `kxr` Row: a 32px-high row, label on the left and its control on the right. */
function Row(props: Omit<ComponentProps<"div">, "className">) {
  return <div className="ui-vo-row" {...props} />;
}

/**
 * `jxr` Label: miniPlus labelMuted. `row` centres beside its control; `full` (`$fullWidth`) spans the section with
 * 8px above and 4px below, over a block such as the Display properties chips.
 */
function Label({ variant = "row", children }: { variant?: "row" | "full"; children: ReactNode }) {
  return (
    <Text as="div" variant="miniPlus" color="muted" data-label={variant} className="ui-vo-label">
      {children}
    </Text>
  );
}

/** `Mxr` SectionLabel: a section's miniPlus labelBase heading ("Board options"), 8px above and 2px below. */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text as="div" variant="miniPlus" color="base" className="ui-vo-section-label">
      {children}
    </Text>
  );
}

/** `Gxr` FieldOptions: the wrapping chip block, 8px under its label with a 1px gap. */
function FieldOptions({ children }: { children: ReactNode }) {
  return <div className="ui-vo-field-options">{children}</div>;
}

/** `Nxr` SmallToggleButton: a jv tab/small chip, controlSecondarySelected while `pressed`. */
function SmallToggleButton({
  pressed,
  ...props
}: { pressed: boolean } & Omit<ComponentProps<typeof Button>, "variant" | "size" | "aria-pressed">) {
  return <Button variant="tab" size="small" aria-pressed={pressed} className="ui-vo-chip" {...props} />;
}

/** `Fxr` SmallIconButton: jv borderless small onlyIcon, 4px either side, beside a SelectButton. */
function SmallIconButton(props: Omit<ComponentProps<typeof IconButton>, "variant" | "size" | "className">) {
  return <IconButton variant="borderless" size="small" className="ui-vo-icon-button" {...props} />;
}

/** `Rxr` SelectButton: Linear's compact Select at 160 x 24, listing under its end edge. */
function SelectButton({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <Select label={label} size="compact" align="end" value={value} onValueChange={onChange} className="ui-vo-select">
      {options.map(([v, l]) => (
        <Select.Option key={v} value={v}>
          {l}
        </Select.Option>
      ))}
    </Select>
  );
}

/** `Kxr` SelectWithToggleWrapper: a SelectButton with its toggle (Direction, Group ordering) in front of it. */
function SelectWithToggleWrapper({ children }: { children: ReactNode }) {
  return <div className="ui-vo-select-toggle">{children}</div>;
}

/**
 * `wxr` Footer: the panel's actions, right-aligned under a bgBorder line, opening with Linear's collapse (`GS`). Render
 * it only while there is something to reset, as Linear does with `hasUserChanges`.
 */
function Footer({ children }: { children: ReactNode }) {
  return <div className="ui-vo-footer">{children}</div>;
}

/** The layout switch atop Linear's view options: `sq` fullWidth tabs, 8px into the section's padding, 16px above the rows. */
function LayoutTabs<Value extends string>({
  value,
  onValueChange,
  layouts,
}: {
  value: Value;
  onValueChange: (value: Value) => void;
  layouts: readonly { value: Value; label: string; icon: ReactNode }[];
}) {
  return (
    <div className="ui-vo-layout">
      <Tabs value={value} onValueChange={(v) => onValueChange(v as Value)}>
        <Tabs.List variant="options" aria-label="Layout">
          {layouts.map((layout) => (
            <Tabs.Tab key={layout.value} value={layout.value}>
              {layout.icon}
              {layout.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
    </div>
  );
}

export const ViewOptions = {
  Container,
  Content,
  Row,
  Label,
  SectionLabel,
  FieldOptions,
  SmallToggleButton,
  SmallIconButton,
  SelectButton,
  SelectWithToggleWrapper,
  Footer,
  LayoutTabs,
};

/** A Row of a label and a SelectButton, with an optional toggle in front of the select (Linear's ordering rows). */
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
  /** A SmallIconButton shown before the select. */
  children?: ReactNode;
}) {
  return (
    <Row>
      <Label>{label}</Label>
      <SelectWithToggleWrapper>
        <SelectButton label={label} value={value} options={options} onChange={onChange} />
        {children}
      </SelectWithToggleWrapper>
    </Row>
  );
}

/** A Row of a label and a small Switch; the whole row toggles it. */
export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: () => void }) {
  return (
    <label className="ui-vo-row">
      <Label>{label}</Label>
      <Switch size="small" aria-label={label} checked={value} onChange={onChange} />
    </label>
  );
}

/** Linear's "Display properties": a full-width Label over FieldOptions of SmallToggleButtons. */
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
    <div className="ui-vo-block">
      <Label variant="full">Display properties</Label>
      <FieldOptions>
        {properties.map(([id, label]) => {
          const pressed = shown.includes(id);
          return (
            <SmallToggleButton
              key={id}
              pressed={pressed}
              onClick={() => onChange(pressed ? shown.filter((p) => p !== id) : [...shown, id])}
            >
              {label}
            </SmallToggleButton>
          );
        })}
      </FieldOptions>
    </div>
  );
}
