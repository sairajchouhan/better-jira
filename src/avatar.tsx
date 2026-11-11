/* oxlint-disable react/set-state-in-effect -- Synchronize local UI state with external resources or reset it when the resource identity changes. */
import { useEffect, useState } from "react";
import { avatarSrc } from "./avatar-proxy";
import type { User } from "./store";

/** The person's Jira photo through the same-origin proxy; their initial while it loads or if it fails; a dashed ring for nobody. */
export function Avatar({ user, size = 20 }: { user: User | null; size?: number }) {
  const [state, setState] = useState<"loading" | "loaded" | "broken">("loading");
  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Reset image loading when the person's photo URL changes.
  useEffect(() => setState("loading"), [user?.avatar]);
  const box = { width: size, height: size };
  if (!user)
    return (
      <span
        title="Unassigned"
        className="inline-block shrink-0 rounded-full border border-dashed border-fg-4"
        style={box}
      />
    );
  const initial = (
    <span
      data-avatar-fallback
      className="absolute inset-0 grid place-items-center rounded-full bg-sel text-fg-2"
      style={{ fontSize: Math.max(8, Math.round(size * 0.5)) }}
    >
      {user.name[0]}
    </span>
  );
  return (
    <span className="relative inline-block shrink-0" style={box} title={user.name}>
      {state !== "loaded" && initial}
      {user.avatar && state !== "broken" && (
        <img
          src={avatarSrc(user.avatar)}
          onLoad={() => setState("loaded")}
          onError={() => setState("broken")}
          alt=""
          width={size}
          height={size}
          className={`absolute inset-0 size-full rounded-full object-cover ${state === "loaded" ? "" : "opacity-0"}`}
        />
      )}
    </span>
  );
}
