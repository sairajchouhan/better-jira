import { createContext, use, useEffect, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { Debouncer } from "@tanstack/pacer";
import { TextInput } from "./field";
import { Icon } from "./icons";
import { shortcutTitle } from "./keycap";

/**
 * Linear's find field ("Find in view…", "Find in inbox…"): its inline find (`Idi`) over its search input (`Adi`), startup-root.
 * A search glyph 8px in, the term sent 150ms after typing stops (`debounceMs: 150`), and the keys of `Fdi.handleKeyDown`:
 * ⌘F selects the term, ↑ and ↓ leave the field for the list, Escape closes it, and every other key stays in the field (⌘K
 * still opens the command menu). Leaving the field empty closes it too. Closing is the owner's: it clears the term and
 * unmounts the field. The field is uncontrolled after it mounts, as Linear's (`initialValue`).
 */
const FindContext = createContext<{ text: string; close: () => void } | null>(null);

function FindFieldRoot({
  ref,
  id,
  placeholder,
  defaultValue = "",
  onValueChange,
  onClose,
  size = "normal",
  className = "",
  inputClassName = "",
  children,
}: {
  ref?: Ref<HTMLInputElement>;
  id?: string;
  /** Also the field's accessible name, as Linear's (`aria-label: placeholder`). */
  placeholder: string;
  defaultValue?: string;
  /** Taken once, when the field mounts, as `defaultValue` is: pass a stable handler. */
  onValueChange: (term: string) => void;
  onClose: () => void;
  size?: "medium" | "normal";
  className?: string;
  inputClassName?: string;
  /** The trailing button: `FindField.Close` or `FindField.Clear`. */
  children?: ReactNode;
}) {
  const [text, setText] = useState(defaultValue);
  const [send] = useState(() => new Debouncer(onValueChange, { wait: 150 }));
  useEffect(() => () => send.cancel(), [send]);
  const close = () => {
    send.cancel();
    onClose();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const mod = event.metaKey || event.ctrlKey,
      key = event.key.toLowerCase();
    if (event.nativeEvent.isComposing || (mod && key === "k")) return;
    event.stopPropagation();
    if (mod && key === "f") {
      event.preventDefault();
      event.currentTarget.select();
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") event.currentTarget.blur();
    else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };
  return (
    <FindContext value={{ text, close }}>
      <form className={`relative flex items-center ${className}`} onSubmit={(event) => event.preventDefault()}>
        <TextInput
          ref={ref}
          id={id}
          type="search"
          size={size}
          aria-label={placeholder}
          placeholder={placeholder}
          value={text}
          spellCheck={false}
          autoComplete="off"
          enterKeyHint="search"
          onChange={(event) => {
            setText(event.target.value);
            send.maybeExecute(event.target.value);
          }}
          onKeyDown={onKeyDown}
          onBlur={(event) => {
            if (!event.currentTarget.value) close();
          }}
          className={`pr-[25px] pl-8 font-medium [&::-webkit-search-cancel-button]:hidden ${inputClassName}`}
        />
        <span aria-hidden className="pointer-events-none absolute top-1/2 left-2 grid -translate-y-1/2 text-fg-3">
          <Icon name="search" />
        </span>
        {children}
      </form>
    </FindContext>
  );
}

function TrailingButton({ label, title }: { label: string; title: string }) {
  const { close } = use(FindContext)!;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      title={title}
      onClick={close}
      className="-ml-[25px] inline-flex cursor-pointer p-[5px] text-fg-3 hover:text-fg-2"
    >
      <Icon name="x" size={12} />
    </button>
  );
}

export const FindField = Object.assign(FindFieldRoot, {
  /** Linear's `showCloseButton`: always there, and it closes the field (Escape). */
  Close: () => <TrailingButton label="Close" title={shortcutTitle("Close", "Escape")} />,
  /** Linear's Clear: there while the field holds text, and it closes the field as Close does (`onClear`). */
  Clear: () => (use(FindContext)!.text ? <TrailingButton label="Clear" title="Clear" /> : null),
});
