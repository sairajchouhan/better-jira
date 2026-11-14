import { createContext, use, useEffect, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { Debouncer } from "@tanstack/pacer";
import { TextInput } from "./field";
import { Icon } from "./icons";
import { shortcutTitle } from "./keycap";
import "./find-field.css";

/**
 * Linear's find field ("Find in view…", "Find in inbox…"): its inline find (`Idi`) over its search input (`Adi`), startup-root.
 * A 16px search glyph 8px in, the term sent 150ms after typing stops (`debounceMs: 150`), and the keys of `Fdi.handleKeyDown`:
 * ⌘F selects the term, ↑ and ↓ leave the field for the list, Escape closes it, and every other key stays in the field (⌘K
 * still opens the command menu). Leaving the field empty closes it too. Closing is the owner's: it clears the term and
 * unmounts the field. The field is uncontrolled after it mounts, as Linear's (`initialValue`).
 *
 * Two boxes, as Linear's: `className` places the container (Idi's `sx`: a header's absolute corner, a tab row's free
 * space), and `inputClassName` restyles the input (Idi's `inputSx`). The search form inside the container stays
 * `relative`, so a placement never has to fight it. Adi's default geometry is in find-field.css.
 */
const FindContext = createContext<{ text: string; close: () => void } | null>(null);

/** Set by FindField.Presence while the field it holds is leaving: `done` unmounts it. */
const LeavingContext = createContext<{ done: () => void } | null>(null);

/** Linear's exit lasts 150ms (`rh` exit, `transition: {duration: .15}`); a little past it, the field goes whether or not its
 *  animation reported its end (a background tab, or no animation at all under reduced motion). */
export const EXIT_FALLBACK_MS = 200;

/**
 * Whether FindField.Presence renders its field, and whether that field is leaving, from the `open` it was given and what it was
 * before. A field that opens again while leaving comes back as a new one (`generation`), with a fresh term from its owner.
 */
export type Presence = { open: boolean; present: boolean; generation: number };
export function nextPresence(state: Presence, open: boolean): Presence {
  if (open === state.open) return state;
  return open ? { open, present: true, generation: state.generation + 1 } : { ...state, open };
}

/**
 * Linear's AnimatePresence around the find field (`rh`, `initial: false`): an open field shows at once, and a closed one stays
 * while it fades 8px up over 150ms, easeOut, inert, before it unmounts. Under reduced motion it goes at once.
 *
 *   <FindField.Presence open={finding}>
 *     <FindField … />
 *   </FindField.Presence>
 */
function Presence({ open, children }: { open: boolean; children: ReactNode }) {
  const [state, setState] = useState<Presence>({ open, present: open, generation: 0 });
  const next = nextPresence(state, open);
  if (next !== state) setState(next);
  // One value for the whole exit, so the field's fallback timer starts once, however often its owner renders meanwhile.
  const [leaving] = useState(() => ({
    done: () => setState((current) => (current.open ? current : { ...current, present: false })),
  }));
  if (!next.present) return null;
  return (
    <LeavingContext key={next.generation} value={next.open ? null : leaving}>
      {children}
    </LeavingContext>
  );
}

function FindFieldRoot({
  ref,
  id,
  placeholder,
  defaultValue = "",
  onValueChange,
  onClose,
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
  /** The container's placement and width (Idi's `sx`). */
  className?: string;
  /** Overrides on the input (Idi's `inputSx`). */
  inputClassName?: string;
  /** The trailing button: `FindField.Close` or `FindField.Clear`. */
  children?: ReactNode;
}) {
  const [text, setText] = useState(defaultValue);
  const [send] = useState(() => new Debouncer(onValueChange, { wait: 150 }));
  const leaving = use(LeavingContext);
  useEffect(() => () => send.cancel(), [send]);
  useEffect(() => {
    if (!leaving) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return leaving.done();
    const timer = setTimeout(leaving.done, EXIT_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [leaving]);
  const close = () => {
    // Already closed: a leaving field's blur (it turns inert) closes nothing again.
    if (leaving) return;
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
      {/* Leaving, it gives up its id and ref at once, so the next field (and a lookup by id, or ⌘F) never finds two. */}
      <div
        className={`ui-find ${className}`}
        data-leaving={leaving ? "" : undefined}
        inert={!!leaving}
        onAnimationEnd={(event) => {
          if (leaving && event.animationName === "ui-find-out") leaving.done();
        }}
      >
        <form className="relative flex items-center" onSubmit={(event) => event.preventDefault()}>
          <TextInput
            ref={leaving ? undefined : ref}
            id={leaving ? undefined : id}
            type="search"
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
            className={inputClassName}
          />
          <span aria-hidden className="pointer-events-none absolute top-1/2 left-2 grid -translate-y-1/2 text-fg-3">
            <Icon name="search" size={16} />
          </span>
          {children}
        </form>
      </div>
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
  Presence,
  /** Linear's `showCloseButton`: always there, and it closes the field (Escape). */
  Close: () => <TrailingButton label="Close" title={shortcutTitle("Close", "Escape")} />,
  /** Linear's Clear: there while the field holds text, and it closes the field as Close does (`onClear`). */
  Clear: () => (use(FindContext)!.text ? <TrailingButton label="Clear" title="Clear" /> : null),
});
