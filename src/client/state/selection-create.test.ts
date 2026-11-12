import { expect, test } from "bun:test";
import { rememberSelectionCreate, refusedSelectionCreate, forgetSelectionCreate } from "./selection-create";
import type { AdfDocument } from "@/shared/document";

test("BJ-170: restoring a refused reference keeps formatting and later surrounding edits", () => {
  const url = "https://example.test/browse/TEST-NEW1";
  const selected = [{ type: "text", text: "Selected", marks: [{ type: "strong" }] }];
  rememberSelectionCreate("TEST-NEW1", "TEST-2", url, selected);
  const refusal = refusedSelectionCreate("TEST-NEW1")!;
  const doc: AdfDocument = { type: "doc", version: 1, content: [{ type: "paragraph", content: [
    { type: "text", text: "Later edit " }, { type: "inlineCard", attrs: { url } },
  ] }] };
  expect(refusal.source).toBe("TEST-2");
  expect(refusal.restore(doc).content![0]!.content).toEqual([{ type: "text", text: "Later edit " }, ...selected]);
  expect(refusedSelectionCreate("TEST-NEW1")).toBeUndefined();
});

test("BJ-170: an accepted create releases its rollback", () => {
  rememberSelectionCreate("TEST-NEW2", "TEST-2", "https://example.test/browse/TEST-NEW2", []);
  forgetSelectionCreate("TEST-NEW2");
  expect(refusedSelectionCreate("TEST-NEW2")).toBeUndefined();
});
