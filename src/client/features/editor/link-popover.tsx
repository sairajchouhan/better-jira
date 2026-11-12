import { useEffect, useRef, useState } from "react";
import type { EditorView } from "prosemirror-view";
import { IconButton } from "@/client/components/button";
import { floatingPlacement, insertLink, linkHref, linkTarget, removeLink } from "./editor-commands";
import { appIssue, followLink } from "./editor-links";
import { TextInput } from "@/client/components/field";
import { Icon } from "@/client/components/icons";
import { MENU_POPUP, usePlacement } from "@/client/components/menu-surface";
import { Text } from "@/client/components/text";

/**
 * Linear's link editor (`Wi`) at the selection: the address, then Open (an issue here) or Open in new window, and Remove
 * link. ↵ or leaving the field applies (an empty address removes the link); Esc cancels. `focus` puts the caret in the
 * field (⌘K or the toolbar's Link); a selected link shows it without taking focus, and clicking the field calls `edit`.
 * `close(true)` hands focus back to the editor with the caret after the link.
 */
export function LinkPopover({
  view,
  focus,
  edit,
  close,
}: {
  view: EditorView;
  focus: boolean;
  edit: () => void;
  close: (refocus: boolean) => void;
}) {
  const [initial] = useState(() => linkHref(view.state)),
    [value, setValue] = useState(initial),
    [error, setError] = useState("");
  const popup = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null),
    done = useRef(false);
  useEffect(() => {
    if (focus) input.current?.focus();
  }, [focus]);
  const { from, to } = view.state.selection;
  const style = usePlacement(
    popup,
    view.dom,
    (area, node) =>
      floatingPlacement(
        view.coordsAtPos(from),
        view.coordsAtPos(to),
        area!,
        { width: node.offsetWidth, height: node.offsetHeight },
        { width: innerWidth, height: innerHeight },
      ),
    `${from} ${to}`,
  );
  const finish = (refocus: boolean) => {
    done.current = true;
    close(refocus);
  };
  const apply = () => {
    const text = value.trim();
    if (!text) {
      removeLink(view.state, view.dispatch);
      return true;
    }
    const href = linkTarget(text);
    if (!href) {
      setError("Enter an http, https, or mailto link.");
      return false;
    }
    insertLink(href)(view.state, view.dispatch);
    return true;
  };
  const href = linkTarget(value);
  return (
    <div
      ref={popup}
      role="group"
      aria-label="Link"
      className={`${MENU_POPUP} fixed z-50 flex w-[320px] flex-wrap items-center gap-1 p-1`}
      style={style}
      // The buttons act on the selection without taking focus from the field or the editor.
      onMouseDown={(event) => {
        if (event.target !== input.current) event.preventDefault();
      }}
    >
      <TextInput
        ref={input}
        size="small"
        aria-label="Link URL"
        placeholder="Enter link URL"
        value={value}
        className="min-w-0 flex-1"
        onFocus={edit}
        onChange={(event) => {
          setValue(event.target.value);
          setError("");
        }}
        onBlur={() => {
          if (done.current) return;
          if (value !== initial) apply();
          finish(false);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape" || apply()) finish(true);
        }}
      />
      {href && (
        <IconButton
          size="small"
          label={appIssue(href) ? "Open" : "Open in new window"}
          onClick={() => followLink(href)}
        >
          <Icon name="external" />
        </IconButton>
      )}
      {initial && (
        <IconButton
          size="small"
          label="Remove link"
          onClick={() => {
            removeLink(view.state, view.dispatch);
            finish(true);
          }}
        >
          <Icon name="trash" />
        </IconButton>
      )}
      {error && (
        <Text role="alert" variant="mini" color="muted" className="w-full px-1">
          {error}
        </Text>
      )}
    </div>
  );
}
