/**
 * A memo shared by every component that asks for the same thing, where `useMemo` is per instance: the filter menu's submenu, its
 * value list, the root search's lists and the next opening of the same submenu all read one result. Results hang off `owner` (the
 * store's issue map, which every mirror update replaces, so they go with it); `key` names one result, and `deps` are compared by
 * identity as `useMemo`'s are: when one changed, the result is computed again and replaces the old one.
 */
export function sharedMemo() {
  const owners = new WeakMap<object, Map<string, { deps: readonly unknown[]; value: unknown }>>();
  return function memo<T>(owner: object, key: string, deps: readonly unknown[], compute: () => T): T {
    let entries = owners.get(owner);
    if (!entries) owners.set(owner, (entries = new Map()));
    const hit = entries.get(key);
    if (hit && hit.deps.length === deps.length && hit.deps.every((dep, i) => Object.is(dep, deps[i])))
      return hit.value as T;
    const value = compute();
    entries.set(key, { deps, value });
    return value;
  };
}
