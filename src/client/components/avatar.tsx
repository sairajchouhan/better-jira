import { type User } from "@/shared/issue-model";
import { useState } from "react";
import { avatarSrc } from "@/shared/avatar-proxy";


/** The person's Jira photo through the same-origin proxy; their initial while it loads or if it fails; a dashed ring for nobody. */
/** `title` is the native tooltip, the person's name by default; null when a hover card names them instead. */
export function Avatar({ user, size = 20, title }: { user: User | null; size?: number; title?: null }) {
  // A new photo URL starts loading again: the state belongs to the URL it was reached for.
  const [loading, setLoading] = useState<{
    avatar?: string;
    state: "loading" | "loaded" | "broken";
  }>({ avatar: user?.avatar, state: "loading" });
  const state = loading.avatar === user?.avatar ? loading.state : "loading";
  const setState = (next: "loaded" | "broken") => setLoading({ avatar: user?.avatar, state: next });
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
    <span className="relative inline-block shrink-0" style={box} title={title === null ? undefined : user.name}>
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
