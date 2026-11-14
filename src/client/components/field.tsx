import { useRef, type CSSProperties, type Ref } from "react";
import {
  Input,
  Label,
  Text,
  TextArea,
  TextField,
  type InputProps,
  type TextAreaProps,
  type TextFieldProps,
  type TextProps,
} from "react-aria-components";
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

/**
 * React Aria's TextField: ties its Label and Description to the one Input or TextArea inside it. Layout is the caller's. Its
 * checks stay the browser's (`required`, `min` on the input), so the browser's own message shows: React Aria's native mode would
 * swallow it for a FieldError we don't draw.
 */
function FieldRoot(props: Omit<TextFieldProps, "validationBehavior">) {
  return <TextField validationBehavior="aria" {...props} />;
}

export const Field = Object.assign(FieldRoot, {
  Label,
  Description: (props: Omit<TextProps, "slot">) => <Text slot="description" elementType="p" {...props} />,
});

/** React Aria's Input in Linear's look; inside a Field it is that Field's control. */
export function TextInput({ size = "normal", className = "", ...props }: { size?: Size; className?: string; ref?: Ref<HTMLInputElement> } & Omit<InputProps, "size" | "className">) {
  return <Input data-size={size} className={`ui-input ${className}`} {...NO_AUTOFILL} {...props} />;
}

/** The hidden copy's text: a trailing zero-width space keeps a final empty line counted in its height. */
export const sizerText = (value: string) => `${value}​`;

/** React Aria's TextArea, growing with its text from 3 to 30 lines, then scrolling. Controlled or uncontrolled, like a textarea;
 *  inside a Field it is that Field's control. */
export function AutoResizingTextArea({
  size = "normal",
  appearance = "input",
  className = "",
  style,
  value,
  defaultValue,
  onInput,
  ...props
}: { size?: Size; appearance?: "input" | "heading"; className?: string; style?: CSSProperties; ref?: Ref<HTMLTextAreaElement> } & Omit<
  TextAreaProps,
  "className" | "style"
>) {
  const sizer = useRef<HTMLDivElement>(null);
  return (
    <div className="ui-autosize" data-appearance={appearance}>
      <TextArea
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
        {...props}
      />
      <div ref={sizer} aria-hidden data-size={size} className={`ui-input ui-autosize-sizer ${className}`} style={style}>
        {sizerText(String(value ?? defaultValue ?? ""))}
      </div>
    </div>
  );
}
