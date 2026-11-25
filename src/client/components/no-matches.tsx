import { Menu } from "./menu";

/**
 * Linear's matching / non-matching split for a filter's options (FilterBlockHelper.BYJnWJwk.js, `subActionsForBlock`): an option
 * with no matches moves behind a "Show N options with no matches" footer, unless it is selected, has no count, or the field has
 * fewer than SPLIT_FROM options (Linear's `a<10`), in which case every option stays inline.
 */
export const SPLIT_FROM = 10;
export function splitByMatches<T>(
  options: T[],
  count: (option: T) => number | undefined,
  selected: (option: T) => boolean,
): { matched: T[]; unmatched: T[] } {
  if (options.length < SPLIT_FROM) return { matched: options, unmatched: [] };
  const unmatched = options.filter((o) => count(o) === 0 && !selected(o));
  return { matched: options.filter((o) => !unmatched.includes(o)), unmatched };
}

export const noMatchesLabel = (n: number) => `Show ${n} option${n === 1 ? "" : "s"} with no matches`;

/** The footer row under the matched options; picking it lists the rest after a divider. */
export function NoMatchesFooter({ count, onReveal }: { count: number; onReveal: () => void }) {
  return (
    <>
      <Menu.Divider />
      <Menu.Item value={noMatchesLabel(count)} onSelect={onReveal}>
        {noMatchesLabel(count)}
      </Menu.Item>
    </>
  );
}
