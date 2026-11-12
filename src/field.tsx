import { createContext, use, useId, useMemo, useRef, type ComponentProps } from "react";
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
  TEXTAREA_HEIGHT: 64,
  AUTOSIZE_LINES: { MIN: 3, MAX: 30 },
} as const;

type Size = keyof typeof FIELD.HEIGHT;

const FieldContext = createContext<{ id: string; descriptionId: string } | null>(null);

/** Ties a label and description to the one control inside it. Layout is the caller's. */
function FieldRoot({ children, ...props }: ComponentProps<"div">) {
  const id = useId(),
    value = useMemo(() => ({ id, descriptionId: `${id}-description` }), [id]);
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
  Description: (props: Omit<ComponentProps<"p">, "id">) => <p id={use(FieldContext)?.descriptionId} {...props} />,
});

export function TextInput({ size = "normal", id, className = "", ...props }: { size?: Size } & Omit<ComponentProps<"input">, "size">) {
  return <input data-size={size} className={`ui-input ${className}`} {...useField(id)} {...props} />;
}

/** A fixed 64px textarea. */
export function TextArea({ size = "normal", id, className = "", ...props }: { size?: Size } & ComponentProps<"textarea">) {
  return <textarea data-size={size} className={`ui-input ${className}`} {...useField(id)} {...props} />;
}

/** The hidden copy's text: a trailing zero-width space keeps a final empty line counted in its height. */
export const sizerText = (value: string) => `${value}​`;

/** Grows with its text from 3 to 30 lines, then scrolls. Controlled or uncontrolled, like a textarea. */
export function AutoResizingTextArea({
  size = "normal",
  id,
  className = "",
  style,
  value,
  defaultValue,
  onInput,
  ...props
}: { size?: Size } & ComponentProps<"textarea">) {
  const sizer = useRef<HTMLDivElement>(null);
  return (
    <div className="ui-autosize" style={style}>
      <textarea
        data-size={size}
        className={`ui-input ${className}`}
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
      <div ref={sizer} aria-hidden data-size={size} className="ui-input ui-autosize-sizer">
        {sizerText(String(value ?? defaultValue ?? ""))}
      </div>
    </div>
  );
}
