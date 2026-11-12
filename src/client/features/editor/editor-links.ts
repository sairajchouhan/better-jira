import { Plugin, TextSelection, type EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { navigate } from "@/client/features/navigation/app-navigation";
import { isMac } from "@/client/components/keycap";
import { richSchema } from "./rich-document";
import { get } from "@/client/state/store";

const link = richSchema.marks.link!;

/** An issue this app has, when `href` is its Jira page: opening it stays in the app. */
export function appIssue(href: string) {
  const browse = `${get().site}/browse/`;
  return href.startsWith(browse) ? get().issues.get(decodeURIComponent(href.slice(browse.length))) : undefined;
}
/** Opens a link from a document: an issue this app has opens here, unless `newTab` (Mod or middle click) asks for Jira's page. */
export function followLink(href: string, newTab = false) {
  const issue = newTab ? undefined : appIssue(href);
  if (issue) navigate({ board: issue.board, selected: issue.key, panel: true, view: get().view });
  else window.open(href, "_blank", "noopener,noreferrer");
}

/** The whole link around `pos`, or null off a link or at the very edge of a link longer than two characters (Linear's
 * getClickSelectionRange), where a click places the caret. */
export function clickSelectionRange(state: EditorState, pos: number): { from: number; to: number } | null {
  const $pos = state.doc.resolve(pos),
    base = $pos.start(),
    runs: { href: unknown; from: number; to: number }[] = [];
  $pos.parent.forEach((child, offset) => {
    const mark = link.isInSet(child.marks),
      last = runs.at(-1),
      at = base + offset;
    if (mark && last?.to === at && last.href === mark.attrs.href) last.to = at + child.nodeSize;
    else if (mark) runs.push({ href: mark.attrs.href, from: at, to: at + child.nodeSize });
  });
  const run = runs.find((r) => r.from <= pos && pos <= r.to);
  if (!run || (run.to - run.from > 2 && (pos === run.from || pos === run.to))) return null;
  return { from: run.from, to: run.to };
}

/** Linear's `sJe`: a non-empty selection in one block that is all link, so the toolbar shows that link instead. */
export function linkSelected(state: EditorState): boolean {
  const { from, to, $from, $to, empty } = state.selection;
  if (empty || !(state.selection instanceof TextSelection) || !$from.sameParent($to)) return false;
  let all = true;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isInline && !link.isInSet(node.marks)) all = false;
  });
  return all;
}

const modKey = () => (isMac() ? "Meta" : "Control");
const anchor = (view: EditorView, event: Event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
  // A media control (Download, open in Jira) keeps its own behaviour.
  if (!target || !view.dom.contains(target) || target.hasAttribute("download") || target.closest("[data-media-interactive]"))
    return null;
  return target;
};

/**
 * Linear's `LinkSelection`. A plain click on a link in the focused editor selects the link (the link popover then shows);
 * Mod-click and middle-click open it, and so does a click that focuses the editor (or comes from a script) or lands on a card. Shift-click,
 * double-click and a drag keep selecting text. Holding Mod marks links clickable (`link-active`).
 */
export const linkPlugin = () => {
  let pressed: { focused: boolean } | null = null;
  const active = (view: EditorView, on: boolean) => view.dom.classList.toggle("link-active", on);
  return new Plugin({
    props: {
      handleDOMEvents: {
        keydown: (view, event) => {
          if (event.key === modKey()) active(view, true);
          return false;
        },
        keyup: (view, event) => {
          if (event.key === modKey()) active(view, false);
          return false;
        },
        blur: (view) => {
          active(view, false);
          return false;
        },
        pointerdown: (view, event) => {
          pressed = { focused: view.hasFocus() };
          // Clicking a link in an unfocused editor opens it, so the editor neither takes focus nor moves the caret.
          if (!pressed.focused && event.button === 0 && anchor(view, event)) event.preventDefault();
          return false;
        },
        auxclick: (view, event) => {
          const target = anchor(view, event);
          if (!target || event.button !== 1) return false;
          event.preventDefault();
          followLink(target.href, true);
          return true;
        },
        click: (view, event) => {
          const target = anchor(view, event),
            focused = pressed?.focused ?? false;
          pressed = null;
          if (!target || event.button !== 0 || event.shiftKey) return false;
          if (isMac() ? event.metaKey : event.ctrlKey) {
            event.preventDefault();
            followLink(target.href, true);
            return true;
          }
          // An issue reference or another card is one token, not editable text: a click opens it, as before.
          if (!focused || !target.isContentEditable) {
            event.preventDefault();
            followLink(target.href);
            return true;
          }
          // A drag or a double-click selected text: leave it.
          // The editor reads the click's caret from the DOM later, so the DOM selection and the click point are the truth here.
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (event.detail > 1 || getSelection()?.isCollapsed === false || !at) return false;
          const range = clickSelectionRange(view.state, at.pos);
          if (!range) return false;
          event.preventDefault();
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to)));
          return true;
        },
      },
    },
  });
};
