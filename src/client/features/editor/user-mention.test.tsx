import { expect, test } from "bun:test";
import { TOOLTIP_TIMING } from "@/client/components/tooltip-rules";
import { personAt } from "@/client/features/navigation/app-navigation";
import { ME } from "@/client/state/store";
import { mentionedUser } from "./user-mention";

test("a mention names the known person with its id, else the mention's own text without its @", () => {
  const priya = { id: "acc-1", name: "Priya Shah", avatar: "https://example.test/p.png" };
  expect(mentionedUser([priya], "acc-1", "@Priya")).toBe(priya);
  expect(mentionedUser([priya], "acc-2", "@Sam Lee")).toEqual({ id: "acc-2", name: "Sam Lee" });
});

test("a mention's card opens on Linear's `HUn` timer: 450ms from the pointer's arrival, not restarted by a move, above it from its start", async () => {
  expect(TOOLTIP_TIMING.documentPopover).toEqual({ delay: 450, restartOnMove: false });
  const source = await Bun.file(new URL("./user-mention.tsx", import.meta.url)).text();
  expect(source).toContain("timing={TOOLTIP_TIMING.documentPopover}");
  expect(source).toContain('placement="top-start"');
  expect(source).toContain('display="inline"');
});

test("a mention is Linear's plain `dtt` text: labelTitle at 500, 600 in a heading or bold, no chip, hover background or pointer", async () => {
  const css = await Bun.file(new URL("../../index.css", import.meta.url)).text();
  const rule = (selector: string) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";
  const mention = rule(".user-mention");
  expect(mention).toContain("color: var(--fg);");
  expect(mention).toContain("font-weight: 500;");
  expect(mention).not.toMatch(/cursor|background|padding/);
  expect(rule(":is(h1, h2, h3, h4, h5, h6, strong, b) .user-mention")).toContain("font-weight: 600;");
  expect(css).not.toMatch(/\.user-mention:hover/);
});

test("the card's name goes to the person's page, and mine to My issues", () => {
  const was = ME.id;
  ME.id = "me-1";
  try {
    expect(personAt("acc-1")).toEqual({ mine: true, person: "acc-1", selected: null, panel: false });
    expect(personAt("me-1")).toEqual({ mine: true, person: null, selected: null, panel: false });
  } finally {
    ME.id = was;
  }
});

test("a mention with no id opens no card, as `HUn` opens one only for a node with an id", async () => {
  const source = await Bun.file(new URL("./user-mention.tsx", import.meta.url)).text();
  expect(source).toContain("isDisabled={!id}");
});
