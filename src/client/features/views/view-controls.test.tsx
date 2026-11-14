import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { set } from "@/client/state/store";
import { PropertySyncNotice } from "./view-controls";

test("R3-views-filters-D-6: the property-load notice takes its menu's width and adds none of its own", () => {
  set({ propertySync: { total: 4, pending: 3, completed: 1, errors: 0 } });
  const html = renderToStaticMarkup(<PropertySyncNotice />);
  expect(html).toContain("Loading Jira properties… 1 / 4");
  expect(html).toMatch(/class="[^"]*\bw-0 min-w-full\b/);
  set({ propertySync: { total: 0, pending: 0, completed: 0, errors: 0 } });
});
