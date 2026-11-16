import { IconButton } from "@/client/components/button";
import { Icon } from "@/client/components/icons";
import { useStore } from "@/client/state/store";
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

/** Keeps a press on the × from also following the favorite row's link it sits in, then removes the favorite. */
export const removeFavoriteClick = (id: string) => (event: Pick<MouseEvent, "preventDefault" | "stopPropagation">) => {
  event.preventDefault();
  event.stopPropagation();
  toggleFavorite(id);
};

/**
 * Linear's favorite row × (`g5n`, startup-root): an action button for `W1` "Remove favorite" with a 10px X (`Dy`), pushed to the
 * row's end 6px after the title (`d0.removeButton`: margin-left 6px, flex none). It always takes its place, so the title never
 * shifts, and shows only while the row is hovered or pressed (`opacity: var(--sx-oknmg0)`, 0 → 1 on the row's :hover/:active,
 * no transition); labelFaint, labelBase under the pointer; a 5px wider hit area (`Cf.moreHitArea(5,5,5,5)`); untouchable on a
 * device that can't hover; gone while its row is dragged (`u5n`: no trailing when `isDragged`); its tooltip is the action's name,
 * below it.
 *
 * Not React Aria's Button or Pressable: a Button is a <button>, which can't sit inside the row's <a>, and Pressable acts on pointer
 * up, before the click that the row's link would then follow. Linear's is a `div role=button` outside the tab order (the row
 * menu's Remove favorite is the keyboard path), so this is a span that acts on its click and keeps that click from the link.
 */
export function RemoveFavoriteButton({ id }: { id: string }) {
  return (
    <span
      role="button"
      aria-label="Remove favorite"
      title="Remove favorite"
      data-remove-favorite
      onClick={removeFavoriteClick(id)}
      className="relative -ml-0.5 flex size-2.5 shrink-0 cursor-default text-fg-4 opacity-0 group-hover/favorite:opacity-100 group-active/favorite:opacity-100 after:absolute after:-inset-[5px] after:content-[''] hover:text-fg-2 active:text-fg-2 in-data-dragged:hidden [@media(hover:none)]:pointer-events-none"
    >
      <Icon name="x" size={10} />
    </span>
  );
}
