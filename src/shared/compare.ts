/**
 * Every string comparison in a sort goes through these two helpers.
 *
 * Natural order uses one cached collator, as Linear's sort builder does (startup-entry `F`:
 * `lx||=new Intl.Collator(void 0,{numeric:!0})`; DocumentsDropHandler `H`): `localeCompare` with options builds a new
 * ICU collator on every call (3,000 keys: 75 ms in V8, 5 ms cached).
 *
 * Plain order stays on `localeCompare` with no options: V8 and JavaScriptCore fast-path that call, and a cached
 * collator's `compare` measured twice as slow there (3,000 names: 1.0 ms against 2.2 ms in V8).
 */
const natural = new Intl.Collator(undefined, { numeric: true });

/** The order of `a.localeCompare(b)`. */
export const compareText = (a: string, b: string) => a.localeCompare(b);
/** Natural order, digits by value: PROJ-9 before PROJ-10. The order of `a.localeCompare(b, undefined, { numeric: true })`. */
export const compareNatural: (a: string, b: string) => number = natural.compare;
