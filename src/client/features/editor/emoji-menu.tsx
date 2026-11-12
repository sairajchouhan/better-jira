import { Suspense, use } from "react";
import { loadEmoji, matchingEmoji, type Emoji } from "./emoji";
import { CaretMenu, type CaretAnchor } from "./mention-menu";

type Props = CaretAnchor & { query: string; pick: (emoji: Emoji) => void };

function Results({ query, pick, ...anchor }: Props) {
  use(loadEmoji());
  return (
    <CaretMenu
      {...anchor}
      width={350}
      label="Insert emoji"
      query={query}
      empty={null}
      items={matchingEmoji(query).map((emoji) => ({
        id: emoji.name,
        label: `:${emoji.name}:`,
        icon: <span aria-hidden>{emoji.char}</span>,
        pick: () => pick(emoji),
      }))}
    />
  );
}

/** Linear's `:` menu. The emoji set is its own chunk; until it arrives the menu stays out of the way. */
export const EmojiMenu = (props: Props) => (
  <Suspense fallback={null}>
    <Results {...props} />
  </Suspense>
);
