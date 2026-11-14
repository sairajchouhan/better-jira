import { expect, test } from "bun:test";
import { Glob } from "bun";

/**
 * Components the React Compiler skips render in full with every parent commit. The compiler skips one quietly when its
 * rules are broken: a ref handed to a function during render, or a setter from a ref-holding object passed as `ref`
 * (BJ-233: the filter menu's 16 `Menu.Submenu` rows re-rendered on every commit of "+"). The build is the judge, as
 * `scripts/build-server.ts` compiles it: a component that calls a hook but has no memo cache was skipped.
 */
const SKIPPED_BEFORE_BJ_233 = [
  "AddBoard",
  "AttachmentsRoot",
  "CaretMenu",
  "CodeBlockControls",
  "CreateIssue",
  "Description",
  "DocumentHeader",
  "DocumentProvider",
  "FilterSaveActions",
  "Hotkeys",
  "ImageCropEditor",
  "ImageViewer",
  "IssueResources",
  "MentionMenu",
  "PropertyFilter",
  "Relations",
  "RichEditor",
  "SubIssues",
  "TableControls",
  "Thread",
  "ToolbarDropdown",
  "VideoPlayer",
];

async function skippedComponents() {
  const files = [...new Glob("src/client/**/*.tsx").scanSync(".")];
  const result = await Bun.build({
    entrypoints: files,
    reactCompiler: true,
    packages: "external",
    target: "browser",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  expect(result.success).toBe(true);
  const skipped = new Set<string>();
  for (const output of result.outputs) {
    // Each top-level function runs to the next top-level statement; a compiled one opens with its memo cache.
    const chunks = (await output.text()).split(/^(?=function |var |let |const |class |export |import )/m);
    for (const chunk of chunks) {
      // The bundler numbers a second component of the same name (`ImageViewer2`).
      const name = chunk.match(/^function ([A-Z]\w*?)\d*\(/)?.[1];
      if (name && !/= _c\d*\(\d+\);/.test(chunk) && /\buse(?:[A-Z]\w*)?\(/.test(chunk)) skipped.add(name);
    }
  }
  return [...skipped].sort();
}

test("the React Compiler compiles every component that uses hooks, the menu's rows included", async () => {
  const skipped = await skippedComponents();
  expect(skipped).not.toContain("MenuSubmenu");
  // Never add a name; fix one and the list must lose it.
  expect(skipped).toEqual(SKIPPED_BEFORE_BJ_233);
}, 30_000);
