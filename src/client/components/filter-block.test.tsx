import { expect, test } from "bun:test";
import { Glob } from "bun";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterBar, FilterBlock } from "./filter-block";

const noop = () => {};
const bar = (actions: boolean) =>
  renderToStaticMarkup(
    <FilterBar label="Active filters">
      <FilterBar.Blocks>
        <FilterBlock onRemove={noop} data-chip="from">
          <FilterBlock.Field>From</FilterBlock.Field>
          <FilterBlock.Operator label="From operator" expanded onOpen={noop}>
            is
          </FilterBlock.Operator>
          <FilterBlock.Value label="From value" icons={[<svg key="a" />, undefined]} onOpen={noop}>
            Automation for Jira
          </FilterBlock.Value>
          <FilterBlock.Remove label="Remove From filter" />
        </FilterBlock>
      </FilterBar.Blocks>
      {actions && (
        <FilterBar.Actions>
          <button>Clear</button>
        </FilterBar.Actions>
      )}
    </FilterBar>,
  );

test("an applied filter is Linear's segmented FilterBlock: field | operator | value | ×, never a single pill", () => {
  const html = bar(false);
  expect(html).toContain('role="group" aria-label="Active filters" class="ui-filter-bar');
  expect(html).toContain('data-chip="from"');
  // Four joined segments; the field is text, operator and value are buttons that open menus, × is the last.
  expect(html.match(/class="ui-filter-segment[ "]/g)).toHaveLength(4);
  expect(html).toMatch(/<span class="ui-filter-segment[^"]*"><span>From<\/span><\/span>/);
  expect(html).toMatch(/<button type="button" class="ui-filter-segment ui-filter-operator" aria-label="From operator" aria-expanded="true"><span>is<\/span>/);
  expect(html).toMatch(/class="ui-filter-segment ui-filter-value" aria-label="From value"/);
  expect(html).toContain('<span class="ui-filter-icons"><span><svg></svg></span></span><span>Automation for Jira</span>');
  expect(html).toMatch(/<button type="button" class="ui-filter-segment ui-filter-remove" aria-label="Remove From filter">/);
});

test("the bar's side (Clear/Save) is a slot: the inbox's panel has none, a view's has its actions", () => {
  expect(bar(false)).not.toContain("ui-filter-actions");
  expect(bar(true)).toContain('<div class="ui-filter-actions"><button>Clear</button></div>');
});

// One applied-filter component, everywhere. A second chip implementation (a pill, a hand-rolled segment row, its own CSS)
// fails here: only filter-block.tsx draws filter segments, only filter-block.css styles them, and every filter bar uses it.
const root = new URL("../", import.meta.url).pathname;
const files = async (pattern: string) => {
  const out: [string, string][] = [];
  for await (const path of new Glob(pattern).scan(root))
    if (!path.includes(".test.")) out.push([path, await Bun.file(root + path).text()]);
  return out;
};

test("no other component draws an applied-filter chip", async () => {
  const chip = /className=["{`][^"}`]*\b[\w-]*filter-(chip|block|segment|operator|remove)\b|\bFilterChip\b|aria-label=\{?`Remove \$\{[^}]+\} filter`/;
  const offenders = (await files("**/*.tsx")).filter(([path, text]) => path !== "components/filter-block.tsx" && chip.test(text));
  expect(offenders.map(([path]) => path)).toEqual([]);
});

test("no other stylesheet styles an applied-filter chip", async () => {
  const selector = /\.[\w-]*filter-(chip|block|segment|operator|remove)\b/;
  const offenders = (await files("**/*.css")).filter(([path, text]) => path !== "components/filter-block.css" && selector.test(text));
  expect(offenders.map(([path]) => path)).toEqual([]);
});

test("every place filters apply renders the shared FilterBlock", async () => {
  for (const path of ["routes/inbox.tsx", "features/views/view-controls.tsx", "features/navigation/palette.tsx"]) {
    const text = await Bun.file(root + path).text();
    expect([path, text.includes('from "@/client/components/filter-block"')]).toEqual([path, true]);
    expect([path, /<FilterBlock\.Remove /.test(text)]).toEqual([path, true]);
  }
});
