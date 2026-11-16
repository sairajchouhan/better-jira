import { initialOf } from "@/shared/person-name";

/** A space's icon (Linear's team icon `ik`): its initial in a 4px-rounded tile, as the sidebar's space rows and the space card draw
 *  it. `size` is the tile's side in px. */
export function SpaceIcon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-[4px] bg-sel font-semibold text-fg-2"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5625) }}
    >
      {initialOf(name)}
    </span>
  );
}
