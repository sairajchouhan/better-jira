import {
  defaultPreferences,
  FIELDS,
  operatorsFor,
  parsePreferences,
  type FilterGroup,
  type Rule,
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
/** False when an overlay `is` rule contradicts a base `is` rule on the same field (Linear: "Cannot merge these filters into the view"). */
export function canMergeOverlay(base: FilterGroup, overlay: FilterGroup): boolean {
  const rules = (g: FilterGroup) => g.children.filter((c): c is Rule => !("children" in c) && c.op === "is");
  const constrained = base.join === "and" || base.children.length === 1 ? rules(base) : [];
  return rules(overlay).every((o) => {
    const b = constrained.find((r) => r.field === o.field);
    return !b || o.values.some((v) => b.values.includes(v));
  });
}
