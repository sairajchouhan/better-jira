import { IconButton, type ButtonVariant } from "./button";
import { Icon } from "./icons";
import { toggleFavorite, useStore } from "./store";

/** The star that favorites a board, view, issue or document: an IconButton switch that reads and toggles `id` in favorites itself.
 *  `noun` names the thing in the label ("Add issue to favorites"); `className` places it. The gold "on" colour is the star's own. */
export function FavoriteButton({
  id,
  noun,
  variant = "muted",
  className = "",
}: {
  id: string;
  noun?: string;
  /** @deprecated The IconButton draws the glyph at its size's icon (14px at medium, Linear's LEe); callers drop this as they migrate. */
  size?: number;
  /** Linear's header star is a muted IconButton (fg-3, hover crumb-hover). */
  variant?: ButtonVariant;
  className?: string;
}) {
  const favorite = useStore((s) => s.favorites.includes(id));
  const thing = noun ? ` ${noun}` : "";
  return (
    <IconButton
      role="switch"
      label={favorite ? `Remove${thing} from favorites` : `Add${thing} to favorites`}
      aria-checked={favorite}
      variant={variant}
      onClick={() => toggleFavorite(id)}
      className={`${className} ${favorite ? "text-[#f2c94c]!" : ""}`}
    >
      <Icon name={favorite ? "starred" : "star"} />
    </IconButton>
  );
}
