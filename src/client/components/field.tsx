import { Children, isValidElement, createContext, use, useId, useMemo, useRef, type ComponentProps, type ReactNode } from "react";
import "./control-tokens.css";
import "./field.css";

/**
 * Linear's input (`ry`/`oy`, appearances `Fke`) and AutoResizingTextarea (AutoResizingTextarea.B1R7eOxL.js), in
 * startup-root.CnUSfl4j.js. field.css spells these out.
 */
export const FIELD = {
  HEIGHT: { small: 26, medium: 28, normal: 32, large: 44, xlarge: 48 },
  PADDING: [6, 12],
  BORDER_RADIUS: 8,
  LARGE_BORDER_RADIUS: 10,
  FONT_SIZE: 13,
  AUTOSIZE_LINES: { MIN: 3, MAX: 30 },
} as const;

type Size = keyof typeof FIELD.HEIGHT;

/**
 * Linear's O4e, spread on every text field that is not a login form: password managers skip it. Without it 1Password's injected
 * script scans the page on each focus (50-150ms on a board), so a menu that focuses its search opens late.
 */
export const NO_AUTOFILL = { "data-1p-ignore": true, "data-form-type": "other", "data-lpignore": "true" } as const;

const FieldContext = createContext<{ id: string; descriptionId?: string } | null>(null);

function FieldDescription(props: Omit<ComponentProps<"p">, "id">) {
  return <p id={use(FieldContext)?.descriptionId} {...props} />;
}

function hasDescription(children: ReactNode): boolean {
  return Children.toArray(children).some(child => isValidElement<{ children?: ReactNode }>(child) &&
    (child.type === FieldDescription || hasDescription(child.props.children)));
}

/** Ties a label and description to the one control inside it. Layout is the caller's. */
function FieldRoot({ children, ...props }: ComponentProps<"div">) {
  const id = useId(),
    described = hasDescription(children),
    value = useMemo(() => ({ id, descriptionId: described ? `${id}-description` : undefined }), [id, described]);
  return (
    <FieldContext value={value}>
      <div {...props}>{children}</div>
    </FieldContext>
  );
}

/** The control's id and description, from the surrounding Field (an explicit `id` wins). */
function useField(id: string | undefined) {
  const field = use(FieldContext);
  return { id: id ?? field?.id, "aria-describedby": field?.descriptionId };
}

export const Field = Object.assign(FieldRoot, {
  Label: (props: Omit<ComponentProps<"label">, "htmlFor">) => <label htmlFor={use(FieldContext)?.id} {...props} />,
  Description: FieldDescription,
});

export function TextInput({ size = "normal", id, className = "", ...props }: { size?: Size } & Omit<ComponentProps<"input">, "size">) {
  return <input data-size={size} className={`ui-input ${className}`} {...NO_AUTOFILL} {...useField(id)} {...props} />;
}

/** The hidden copy's text: a trailing zero-width space keeps a final empty line counted in its height. */
export const sizerText = (value: string) => `${value}​`;

/** Grows with its text from 3 to 30 lines, then scrolls. Controlled or uncontrolled, like a textarea. */
export function AutoResizingTextArea({
  size = "normal",
  appearance = "input",
  id,
  className = "",
  style,
  value,
  defaultValue,
  onInput,
  ...props
}: { size?: Size; appearance?: "input" | "heading" } & ComponentProps<"textarea">) {
  const sizer = useRef<HTMLDivElement>(null);
  return (
    <div className="ui-autosize" data-appearance={appearance}>
      <textarea
        {...NO_AUTOFILL}
        data-size={size}
        className={`ui-input ${className}`}
        style={style}
        value={value}
        defaultValue={defaultValue}
        onInput={(event) => {
          // Uncontrolled text never re-renders, so the copy follows the DOM.
          if (value === undefined && sizer.current) sizer.current.textContent = sizerText(event.currentTarget.value);
          onInput?.(event);
        }}
        {...useField(id)}
        {...props}
      />
      <div ref={sizer} aria-hidden data-size={size} className={`ui-input ui-autosize-sizer ${className}`} style={style}>
        {sizerText(String(value ?? defaultValue ?? ""))}
      </div>
    </div>
  );
}
