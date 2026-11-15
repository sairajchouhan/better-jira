import { useEffect, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { Text } from "@/client/components/text";
import { passesTitleLimit, TITLE_MAX, TITLE_TOO_LONG } from "@/shared/issue-title";

type Field = HTMLInputElement | HTMLTextAreaElement;
/** How long the message stays: Linear's `uQ` label clears itself after 2s (`setTimeout(()=>{g(!1)},2e3)`). */
export const TITLE_LIMIT_MESSAGE_MS = 2000;

const at = (field: Field) => ({
  length: field.value.length,
  start: field.selectionStart ?? field.value.length,
  end: field.selectionEnd ?? field.value.length,
});

/**
 * The title limit for one title field (shared/issue-title.ts). `props` go on the field: the native `maxLength` refuses typing past
 * the limit and cuts a paste to fit, and a title already longer can only shrink, as Linear's `eZe` does; a key or paste that hits
 * the limit shows `message`, Linear's red label under its title field (`displayErrorAs: "label"`), which a click dismisses.
 */
export function useTitleLimit() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setShown(false), TITLE_LIMIT_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  const check = (field: Field, inserted: string) => {
    if (passesTitleLimit(at(field), inserted)) setShown(true);
  };
  return {
    props: {
      maxLength: TITLE_MAX,
      // Capture: the field's own key handler (title-flow.ts) may end the event.
      onKeyDownCapture: (event: KeyboardEvent<Field>) => {
        const { key, metaKey, ctrlKey, altKey } = event;
        if (key.length === 1 && !metaKey && !ctrlKey && !altKey && !event.nativeEvent.isComposing)
          check(event.currentTarget, key);
      },
      onPaste: (event: ClipboardEvent<Field>) =>
        check(event.currentTarget, event.clipboardData.getData("text/plain").replace(/[\r\n]+/g, " ")),
    },
    message: shown ? <TitleLimitMessage dismiss={() => setShown(false)} /> : null,
  };
}

function TitleLimitMessage({ dismiss }: { dismiss: () => void }) {
  return (
    // Linear's label: Text smallPlus in redBase, the pointer cursor, a click hides it.
    <Text as="div" variant="smallPlus" color="inherit" role="alert" data-title-limit onClick={dismiss} style={{ color: "var(--red-base)", cursor: "pointer" }}>
      {TITLE_TOO_LONG}
    </Text>
  );
}
