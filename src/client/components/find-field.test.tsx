import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { EXIT_FALLBACK_MS, FindField, findTermSender, nextPresence } from "./find-field";

const render = (props: { className?: string; inputClassName?: string } = {}) =>
  renderToStaticMarkup(
    <FindField placeholder="Find in view…" onValueChange={() => {}} onClose={() => {}} {...props}>
      <FindField.Close />
    </FindField>,
  );
const classesOf = (html: string, tag: string) =>
  [...html.matchAll(new RegExp(`<${tag}[^>]*class="([^"]*)"`, "g"))].map((m) => m[1]!.split(/\s+/).filter(Boolean));

test("a placement lands on the container, never on the relative search form (Linear's Idi `sx` around Adi)", () => {
  const html = render({ className: "absolute top-1.5 right-1 z-10 w-[160px]" });
  const [container] = classesOf(html, "div");
  expect(container).toEqual(["ui-find", "absolute", "top-1.5", "right-1", "z-10", "w-[160px]"]);
  const [form] = classesOf(html, "form");
  expect(form).toEqual(["relative", "flex", "items-center"]);
  // Two position utilities on one element: Tailwind emits `relative` after `absolute`, so the field fell into the header's flow.
  for (const classes of [...classesOf(html, "div"), ...classesOf(html, "form")])
    expect(classes.filter((c) => ["absolute", "relative", "fixed", "sticky", "static"].includes(c)).length).toBeLessThanOrEqual(1);
  expect(html.indexOf("<div")).toBeLessThan(html.indexOf("<form"));
});

test("the input wears Adi's default look from the find field itself, with only the owner's inputSx added", () => {
  const plain = render();
  const [input] = classesOf(plain, "input");
  expect(input).toEqual(["ui-input"]);
  expect(plain).toContain('data-size="normal"');
  expect(plain).toContain('type="search"');
  expect(plain).toContain('aria-label="Find in view…"');
  const [restyled] = classesOf(render({ inputClassName: "h-8 rounded-[6px]" }), "input");
  expect(restyled).toEqual(["ui-input", "h-8", "rounded-[6px]"]);
});

test("the search glyph is Linear's 16px icon, 8px in", () => {
  const html = render();
  expect(html).toMatch(/<span aria-hidden="true" class="[^"]*left-2[^"]*"><svg[^>]*width="16"[^>]*height="16"/);
});

test("find-field.css carries Adi's default geometry and Idi's container", () => {
  const css = readFileSync(new URL("./find-field.css", import.meta.url), "utf8");
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    expect(at).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at));
  };
  // Rdi.container: max-width 50vw, overflow hidden; ContentViewHeaderInlineSearch animates in from 8px up over 150ms.
  const container = rule(".ui-find");
  expect(container).toContain("max-width: 50vw;");
  expect(container).toContain("overflow: hidden;");
  expect(container).toContain("animation: ui-find-in 0.15s ease-out;");
  expect(css).toMatch(/@keyframes ui-find-in \{\s*from \{\s*opacity: 0;\s*transform: translateY\(-8px\);/);
  // R7.input + jdi.default: 28px, 32px glyph inset, 25px for the trailing button, weight 500, labelMuted placeholder.
  const input = rule(".ui-find .ui-input");
  for (const declaration of ["height: 28px;", "padding-left: 32px;", "padding-right: 25px;", "font-weight: 500;", "background: var(--panel);"])
    expect(input).toContain(declaration);
  expect(rule(".ui-find .ui-input::placeholder")).toContain("color: var(--fg-3);");
  // The keyboard ring sits on the border, inside the box (oy.inputOutlineOffset), so it never draws a second, outer ring.
  const field = readFileSync(new URL("./field.css", import.meta.url), "utf8");
  expect(field.slice(field.indexOf(".ui-input {"), field.indexOf("}", field.indexOf(".ui-input {")))).toContain("outline-offset: -1px;");
});

test("FindField.Presence keeps a closed field while it leaves, and brings a reopened one back as a new field", () => {
  const shown = { open: true, present: true, generation: 0 };
  // Closing keeps it present (leaving); FindField.Presence drops it when its exit ends.
  const leaving = nextPresence(shown, false);
  expect(leaving).toEqual({ open: false, present: true, generation: 0 });
  // Reopened mid-exit (or after), it is a new field: a fresh term and Debouncer from its owner.
  expect(nextPresence(leaving, true)).toEqual({ open: true, present: true, generation: 1 });
  expect(nextPresence({ open: false, present: false, generation: 1 }, true)).toEqual({ open: true, present: true, generation: 2 });
  expect(nextPresence(shown, true)).toBe(shown);
  const field = (open: boolean) =>
    renderToStaticMarkup(
      <FindField.Presence open={open}>
        <FindField id="find-in-view" placeholder="Find in view…" onValueChange={() => {}} onClose={() => {}} />
      </FindField.Presence>,
    );
  expect(field(true)).toContain('id="find-in-view"');
  expect(field(true)).not.toContain("data-leaving");
  expect(field(false)).toBe("");
});

test("closing, the field fades 8px up over 150ms easeOut (Linear's rh exit), and not at all under reduced motion", () => {
  const css = readFileSync(new URL("./find-field.css", import.meta.url), "utf8");
  const at = css.indexOf(".ui-find[data-leaving] {");
  expect(at).toBeGreaterThan(-1);
  expect(css.slice(at, css.indexOf("}", at))).toContain("animation: ui-find-out 0.15s ease-out forwards;");
  expect(css).toMatch(/@keyframes ui-find-out \{\s*to \{\s*opacity: 0;\s*transform: translateY\(-8px\);/);
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.ui-find,\s*\.ui-find\[data-leaving\] \{\s*animation: none;/);
  expect(EXIT_FALLBACK_MS).toBeGreaterThan(150);
});

test("the board's find floats in its header like the inbox's (ContentViewHeaderInlineSearch), and the header's buttons fade under it", () => {
  const chrome = readFileSync(new URL("../features/navigation/app-chrome.tsx", import.meta.url), "utf8");
  const header = chrome.slice(chrome.indexOf("export function BoardHeader"), chrome.indexOf("// --- board ---"));
  const row = header.slice(header.indexOf("<PageHeader"), header.indexOf("</PageHeader>"));
  expect(row).toContain('<PageHeader className="relative justify-between">');
  expect(row).toMatch(/<FindField\.Presence open=\{finding\}>\s*<FindField\s+id="find-in-view"/);
  expect(row).toContain('className="absolute top-1.5 right-2 z-10 w-[160px]"');
  expect(row).toMatch(/inert=\{finding\}[\s\S]*pointer-events-none opacity-0[\s\S]*New issue/);
  expect(header.slice(header.indexOf("</PageHeader>"))).not.toContain("<FindField");
});

test("a closed find field sends no term still waiting out its debounce, so the term its owner cleared stays cleared", async () => {
  const sent: string[] = [];
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const send = findTermSender((term) => sent.push(term), 20);
  send.type("no");
  send.cancel(); // StrictMode's replay of the unmount cleanup: the field still sends what is typed next
  send.type("no match");
  await wait(40);
  expect(sent).toEqual(["no match"]);
  send.type("no matching issue");
  send.close(); // the owner leaves the page (a breadcrumb) and clears the term; the field fades out
  send.type("late");
  await wait(40);
  expect(sent).toEqual(["no match"]);
  // A field its owner closes is leaving, not unmounted, for its 150ms fade: that is when it must stop sending.
  const source = readFileSync(new URL("./find-field.tsx", import.meta.url), "utf8");
  expect(source).toMatch(/if \(!leaving\) return;[^}]*send\.close\(\);/);
});
