import { IconButton } from "./button";
import { Icon } from "./icons";
import { useStore } from "./store";
import { toggleFavorite } from "./favorites";

/** The star that favorites a board, view, issue or document: an IconButton switch that reads and toggles `id` in favorites itself.
 *  `noun` names the thing in the label ("Add issue to favorites"); `className` places it. The gold "on" colour is the star's own. */
export function FavoriteButton({
  id,
  noun,
  className = "",
}: {
  id: string;
  noun?: string;
  className?: string;
}) {
  const favorite = useStore((s) => s.favorites.includes(id));
  const thing = noun ? ` ${noun}` : "";
  return (
    <IconButton
      role="switch"
      label={favorite ? `Remove${thing} from favorites` : `Add${thing} to favorites`}
      aria-checked={favorite}
      variant="muted"
      onClick={() => toggleFavorite(id)}
      className={`${className} ${favorite ? "text-[#f2c94c]!" : ""}`}
    >
      <Icon name={favorite ? "starred" : "star"} />
    </IconButton>
  );
}
