import { Icon } from "./icons";
import { toggleFavorite, useStore } from "./store";

/** The star that favorites a board, view, issue or document: a switch that reads and toggles `id` in favorites itself.
 *  `noun` names the thing in the label ("Add issue to favorites"); `className` is the frame, the gold "on" colour wins over it. */
export function FavoriteButton({
  id,
  noun,
  size,
  className,
}: {
  id: string;
  noun?: string;
  size: number;
  className: string;
}) {
  const favorite = useStore((s) => s.favorites.includes(id));
  const thing = noun ? ` ${noun}` : "";
  return (
    <button
      role="switch"
      aria-label={favorite ? `Remove${thing} from favorites` : `Add${thing} to favorites`}
      aria-checked={favorite}
      onClick={() => toggleFavorite(id)}
      className={`${className} ${favorite ? "text-[#f2c94c]!" : ""}`}
    >
      <Icon name={favorite ? "starred" : "star"} size={size} />
    </button>
  );
}
