import {
  defaultPreferences,
  type Rule,
  FIELDS,
  operatorsFor,
  parsePreferences,
  type FilterGroup,
  type Display,
  type Scope,
} from "./view-model";

export type SavedView = {
  id: string;
  board: number;
  kind: "tab" | "custom";
  name: string;
  icon: string;
  color: string;
  description: string;
  filters: FilterGroup;
  display: Display;
  scope: Scope;
  mine: boolean;
  createdAt: string;
  updatedAt: string;
};
export type ViewDraft = Omit<SavedView, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
  /** A duplicate's source view: Cancel returns there. Never sent as part of the definition. */
  sourceId?: string;
};
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 1000): v is string => typeof v === "string" && v.length <= max;
export function validFilters(value: unknown): value is FilterGroup {
  let count = 0;
  const ids = new Set<string>();
  function visit(v: unknown, depth: number): boolean {
    if (!object(v) || depth > 6 || ++count > 300 || !text(v.id, 128) || !v.id || ids.has(v.id))
      return false;
    ids.add(v.id);
    if ("children" in v)
      return (
        (v.join === "and" || v.join === "or") &&
        Array.isArray(v.children) &&
        v.children.length <= 50 &&
        v.children.every((c) => visit(c, depth + 1))
      );
    return (
      FIELDS.some(([f]) => f === v.field) &&
      operatorsFor(v.field).some(([op]) => op === v.op) &&
      Array.isArray(v.values) &&
      v.values.length <= 100 &&
      v.values.every((s: unknown) => text(s))
    );
  }
  return object(value) && Array.isArray(value.children) && visit(value, 0);
}
export function validateDraft(v: unknown): ViewDraft {
  if (
    !object(v) ||
    !Number.isSafeInteger(v.board) ||
    v.board <= 0 ||
    !["tab", "custom"].includes(v.kind) ||
    !text(v.name, 200) ||
    !v.name.trim() ||
    !text(v.icon, 100) ||
    !text(v.color, 100) ||
    !text(v.description, 10000) ||
    !validFilters(v.filters) ||
    !["all", "active", "backlog"].includes(v.scope) ||
    typeof v.mine !== "boolean"
  )
    throw new Error("Invalid view definition");
  const parsed = parsePreferences({ display: v.display }).display;
  if (
    !object(v.display) ||
    Object.keys(parsed).some(
      (k) => JSON.stringify(parsed[k as keyof Display]) !== JSON.stringify(v.display[k]),
    )
  )
    throw new Error("Invalid view display");
  return {
    board: v.board,
    kind: v.kind,
    name: v.name.trim(),
    icon: v.icon,
    color: v.color,
    description: v.description,
    filters: structuredClone(v.filters),
    display: parsed,
    scope: v.scope,
    mine: v.mine,
  };
}
export const emptyOverlay = (): FilterGroup => ({
  id: "overlay",
  join: "and",
  children: [],
});
/** Always AND whole trees: flattening an OR group would widen the saved base. */
export function mergeFilters(base: FilterGroup, overlay: FilterGroup): FilterGroup {
  if (!overlay.children.length) return structuredClone(base);
  if (!base.children.length) return structuredClone(overlay);
  // Imported rules can have the same ids. Re-key the merged tree for safe later editing.
  const merged: FilterGroup = {
    id: crypto.randomUUID(),
    join: "and",
    children: structuredClone([base, overlay]),
  };
  const rekey = (g: FilterGroup) => {
    g.id = crypto.randomUUID();
    for (const c of g.children) {
      c.id = crypto.randomUUID();
      if ("children" in c) rekey(c);
    }
  };
  rekey(merged);
  return merged;
}
export const MERGE_CONFLICT = "Cannot merge these filters into the view";
/** Rules every matching issue must satisfy: top-level AND rules, descending into AND (or single-child) groups. */
function requiredRules(g: FilterGroup): Rule[] {
  const live = g.children.filter((c) => "children" in c || c.values.length || c.op === "empty" || c.op === "notEmpty");
  if (g.join === "or" && live.length > 1) return [];
  return live.flatMap((c) => ("children" in c ? requiredRules(c) : [c]));
}
/** False when an overlay rule on a saved field asks for values the saved base excludes,
 * e.g. saved Status is Todo + overlay Status is In Progress: the merge could match no issue. */
export function canMergeOverlay(base: FilterGroup, overlay: FilterGroup): boolean {
  const saved = requiredRules(base);
  const excludes = (a: Rule, b: Rule) =>
    (a.op === "is" && b.op === "is" && !a.values.some((v) => b.values.includes(v))) ||
    (a.op === "is" && b.op === "isNot" && a.values.every((v) => b.values.includes(v))) ||
    (a.op === "empty" && b.op === "notEmpty");
  return !requiredRules(overlay).some((o) =>
    saved.some((b) => o.field === b.field && (excludes(o, b) || excludes(b, o))),
  );
}
const slug = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
/** `/view/<slug>-<id>`. The id suffix is canonical; the slug follows the name. */
export const viewPath = (v: Pick<SavedView, "id" | "name">) =>
  `/view/${encodeURIComponent(slug(v.name) ? `${slug(v.name)}-${v.id}` : v.id)}`;
/** Resolves `<id>`, `<slug>-<id>` and stale slugs to the view. */
export function viewForRoute<T extends Pick<SavedView, "id">>(views: T[], segment: string): T | undefined {
  let s = segment;
  try {
    s = decodeURIComponent(segment);
  } catch {
    /* Keep the raw segment. */
  }
  return (
    views.find((v) => v.id === s) ??
    views
      .filter((v) => s.endsWith(`-${v.id}`))
      .sort((a, b) => b.id.length - a.id.length)[0]
  );
}
export function encodeOverlay(filters: FilterGroup): string {
  if (!validFilters(filters)) throw new Error("Invalid filters");
  const encoded = btoa(
    String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ v: 1, filters }))),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  if (encoded.length > 32000) throw new Error("Filters are too large for a URL");
  return encoded;
}
export function decodeOverlay(encoded: string | null): FilterGroup {
  if (!encoded) return emptyOverlay();
  try {
    if (encoded.length > 32000 || !/^[\w-]+$/.test(encoded)) throw new Error();
    const v = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(atob(encoded.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
          c.charCodeAt(0),
        ),
      ),
    );
    if (v.v !== 1 || !validFilters(v.filters)) throw new Error();
    return v.filters;
  } catch {
    return emptyOverlay();
  }
}
/** Keeps legacy ids and snapshot semantics. Caller retains the source until the atomic import succeeds. */
export function migrateLegacyViews(raw: string | null): SavedView[] {
  const values = JSON.parse(raw ?? "[]");
  if (!Array.isArray(values)) throw new Error("Invalid legacy views");
  return values.map((v) => {
    if (!object(v) || !text(v.id, 128) || !/^[\w-]+$/.test(v.id))
      throw new Error("Invalid legacy view id");
    const p = parsePreferences(v.preferences ?? defaultPreferences());
    const draft = validateDraft({
      ...v,
      kind: v.kind ?? "custom",
      icon: v.icon ?? "filter",
      color: v.color ?? "gray",
      description: v.description ?? "",
      filters: v.filters ?? p.filters,
      display: v.display ?? p.display,
      scope: v.scope ?? p.scope,
      mine: v.mine === true,
    });
    const at = new Date().toISOString();
    return {
      ...draft,
      id: v.id,
      createdAt: v.createdAt ?? at,
      updatedAt: v.updatedAt ?? at,
    };
  });
}
