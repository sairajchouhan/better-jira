/**
 * Linear's code block chrome (`N0e` and the `cb-*` classes in startup-root.CnUSfl4j.js), shared by the editor's node view and the
 * read-only description: line numbers, highlighting, the hover toolbar (language, display options, copy, delete) and the
 * collapse bar of a long block. The editor and the read-only view render the same controls component.
 */
import { compareText } from "@/shared/compare";
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ActionMenu, type ActionEntry } from "@/client/components/action-menu";
import { Button, IconButton } from "@/client/components/button";
import { Icon } from "@/client/components/icons";
import { Popover, MENU_POPUP, useElevation } from "@/client/components/menu-surface";
import { Switch } from "@/client/components/switch";
import { Toast } from "@/client/components/toast";
import { toasts } from "@/client/components/toast-queue";
import {
  CODE_LANGUAGES,
  COLLAPSE_LINES,
  highlightCode,
  highlighterVersion,
  languageLabel,
  lineStarts,
  onHighlighter,
  type CodeToken,
} from "./code-languages";
import { copyText } from "@/client/lib/clipboard";

/** The display options, a view preference of this browser. Linear keeps line numbers as a user setting (on by default)
 *  and wrapping per block; Jira gives a block no stable id, so wrapping is one preference here too. */
export type CodeDisplay = { lineWrap: boolean; lineNumbers: boolean };
const DISPLAY_KEY = "better-jira:code-display:v1",
  displayListeners = new Set<() => void>();
let display: CodeDisplay = (() => {
  try {
    return { lineWrap: false, lineNumbers: true, ...JSON.parse(localStorage.getItem(DISPLAY_KEY) ?? "{}") };
  } catch {
    return { lineWrap: false, lineNumbers: true };
  }
})();
export const codeDisplay = {
  get: () => display,
  set(patch: Partial<CodeDisplay>) {
    display = { ...display, ...patch };
    try {
      localStorage.setItem(DISPLAY_KEY, JSON.stringify(display));
    } catch {
      /* The preference lasts for this page only. */
    }
    for (const listener of displayListeners) listener();
  },
  subscribe: (listener: () => void) => (displayListeners.add(listener), () => void displayListeners.delete(listener)),
};
const useCodeDisplay = () => useSyncExternalStore(codeDisplay.subscribe, codeDisplay.get, codeDisplay.get);

/** The data attributes Linear's CSS keys a code block's look on. */
export function codeBlockAttributes(lines: number, collapsed: boolean, view: CodeDisplay) {
  return {
    "data-collapsible": collapsed || lines >= COLLAPSE_LINES ? "true" : undefined,
    "data-collapsed": collapsed ? "true" : undefined,
    "data-line-wrap": view.lineWrap ? "true" : undefined,
    "data-line-numbers": view.lineNumbers ? undefined : "false",
  };
}

/** Copy content (Linear's `copyFragmentToClipboard` messages). */
async function copyCode(text: string) {
  let message = "Code contents copied to clipboard";
  try {
    await copyText(text);
  } catch {
    message = "Code contents could not be copied to clipboard";
  }
  toasts.show(
    <Toast>
      {message}
      <Toast.Close />
    </Toast>,
  );
}

/**
 * Wrapped lines take several rows, so each line number gets its line's height (Linear's gutter `W0e.measure`): the top of
 * every line's first character, read with a Range. Unwrapped, every row is one line high.
 */
export function measureGutter(gutter: HTMLElement, code: HTMLElement, wrap: boolean) {
  const rows = [...gutter.children] as HTMLElement[];
  for (const row of rows) row.style.height = "";
  if (!wrap || !code.offsetHeight) return;
  const starts = lineStarts(code.textContent ?? ""),
    tops: number[] = [],
    range = document.createRange(),
    walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  let offset = 0,
    index = 0;
  for (let node = walker.nextNode() as Text | null; node && index < starts.length; node = walker.nextNode() as Text | null) {
    const end = offset + node.length;
    while (index < starts.length && starts[index]! < end) {
      const at = starts[index++]! - offset;
      range.setStart(node, at);
      range.setEnd(node, Math.min(at + 1, node.length));
      const rects = range.getClientRects();
      tops.push((rects[rects.length - 1] ?? range.getBoundingClientRect()).top);
    }
    offset = end;
  }
  rows.forEach((row, i) => {
    const next = tops[i + 1];
    if (tops[i] !== undefined && next !== undefined) row.style.height = `${next - tops[i]!}px`;
  });
}

/** The language menu's rows (Linear's picker `w`): Auto detect, then every language by name, the stored one checked. */
function languageEntries(language: string | null, pick: (id: string | null) => void): ActionEntry[] {
  return [
    { name: "Auto detect", selected: language == null, run: () => pick(null) },
    ...[...CODE_LANGUAGES]
      .sort((a, b) => compareText(a.name, b.name))
      .map((l, i) => ({
        name: l.name,
        keywords: l.aliases,
        divider: i === 0,
        selected: language != null && (l.id === language || l.aliases.includes(language.toLowerCase())),
        run: () => pick(l.id),
      })),
  ];
}

/**
 * The code block's toolbar (top right, shown on hover) and, for a long block, its Expand/Collapse bar. Without `setLanguage`
 * the block is read-only: the language is a label and nothing deletes it.
 */
export function CodeBlockControls({
  text,
  language,
  detected,
  collapsed,
  setCollapsed,
  setLanguage,
  remove,
}: {
  text: string;
  language: string | null;
  /** The auto-detected language; undefined while detecting. */
  detected?: string | null;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  setLanguage?: (language: string | null) => void;
  remove?: () => void;
}) {
  const view = useCodeDisplay();
  const elevation = useElevation();
  const lines = lineStarts(text).length,
    collapsible = collapsed || lines >= COLLAPSE_LINES;
  const languageButton = useRef<HTMLButtonElement>(null),
    displayButton = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<"language" | "display" | null>(null);
  const keep = (event: { preventDefault: () => void }) => event.preventDefault();
  return (
    <>
      <div className="cb-copy" role="group" aria-label="Code block actions" data-popover-open={menu ? "true" : undefined} onMouseDown={keep}>
        {collapsible && !collapsed && (
          <IconButton label="Collapse" size="small" onClick={() => setCollapsed(true)}>
            <Icon name="up" />
          </IconButton>
        )}
        <Button
          ref={languageButton}
          variant="borderless"
          size="small"
          className="cb-language"
          tooltip={setLanguage ? "Change language" : "Language"}
          aria-haspopup={setLanguage ? "menu" : undefined}
          aria-expanded={setLanguage ? menu === "language" : undefined}
          data-readonly={setLanguage ? undefined : "true"}
          onClick={setLanguage && (() => setMenu(menu === "language" ? null : "language"))}
        >
          {languageLabel(language, detected)}
          {setLanguage && <Icon name="down" size={12} />}
        </Button>
        <IconButton
          ref={displayButton}
          label="Display options"
          size="small"
          aria-expanded={menu === "display"}
          onClick={() => setMenu(menu === "display" ? null : "display")}
        >
          <Icon name="display" />
        </IconButton>
        <IconButton label="Copy content" size="small" onClick={() => void copyCode(text)}>
          <Icon name="copy" />
        </IconButton>
        {remove && (
          <IconButton label="Delete code block" size="small" onClick={remove}>
            <Icon name="trash" />
          </IconButton>
        )}
      </div>
      {collapsible && (
        <div className="cb-ex-col" onMouseDown={keep}>
          <Button variant="secondary" size="small" onClick={() => setCollapsed(!collapsed)}>
            <span className={`grid place-items-center ${collapsed ? "rotate-90" : "-rotate-90"}`}>
              <Icon name="chevron" size={12} />
            </span>
            {collapsed ? `Expand (${lines} lines)` : "Collapse"}
          </Button>
        </div>
      )}
      {menu === "language" && setLanguage && (
        <ActionMenu
          label="Language"
          anchor={languageButton.current}
          highlight="first"
          entries={languageEntries(language, setLanguage)}
          close={() => setMenu(null)}
        />
      )}
      {menu === "display" && (
        <Popover trigger={displayButton} placement="bottom-right" popup={popup} close={() => setMenu(null)}>
          <div role="group" aria-label="Display options" {...elevation.props} className={`${MENU_POPUP} cb-display-options`}>
            {(
              [
                ["lineWrap", "Wrap lines"],
                ["lineNumbers", "Show line numbers"],
              ] as const
            ).map(([option, label]) => (
              <Switch key={option} size="small" isSelected={view[option]} onChange={(on) => codeDisplay.set({ [option]: on })}>
                {label}
                <Switch.Indicator />
              </Switch>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

/** Code with its tokens as spans, for the read-only view (the editor decorates its own text). */
function tokenized(text: string, tokens: CodeToken[]): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const token of tokens) {
    if (token.from > at) out.push(text.slice(at, token.from));
    out.push(
      <span key={token.from} className={token.className}>
        {text.slice(token.from, token.to)}
      </span>,
    );
    at = token.to;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** A Jira codeBlock in the read-only view, looking as it does in the editor. */
export function ReadonlyCodeBlock({ text, language }: { text: string; language: string | null }) {
  useSyncExternalStore(onHighlighter, highlighterVersion, highlighterVersion);
  const view = useCodeDisplay(),
    lines = lineStarts(text).length,
    [collapsed, setCollapsed] = useState(() => lines >= COLLAPSE_LINES),
    highlight = highlightCode(text, language),
    gutter = useRef<HTMLDivElement>(null),
    code = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const measure = () => gutter.current && code.current && measureGutter(gutter.current, code.current, view.lineWrap);
    measure();
    if (!view.lineWrap || !code.current) return;
    const observer = new ResizeObserver(measure);
    observer.observe(code.current);
    return () => observer.disconnect();
  }, [text, view.lineWrap, highlight]);
  return (
    <pre className="code-block" {...codeBlockAttributes(lines, collapsed, view)}>
      <div ref={gutter} className="cb-gutter" aria-hidden>
        {Array.from({ length: lines }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <code ref={code} onClick={collapsed ? () => setCollapsed(false) : undefined}>
        {highlight ? tokenized(text, highlight.tokens) : text}
      </code>
      <div className="cb-controls">
        <CodeBlockControls
          text={text}
          language={language}
          detected={language == null ? highlight?.language : null}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
        />
      </div>
    </pre>
  );
}
