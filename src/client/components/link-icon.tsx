import { useState } from "react";
import { Icon } from "./icons";

/** A site's icon, falling back to the link icon when it does not load. One control for resources and smart links. */
export function LinkIcon({ src, size = 16, className = "rounded-full" }: { src?: string; size?: 14 | 16; className?: string }) {
  const [failed, setFailed] = useState<string>();
  return src && failed !== src ? (
    <img
      data-link-icon
      alt=""
      src={src}
      width={size}
      height={size}
      onError={() => setFailed(src)}
      className={`shrink-0 object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  ) : (
    <Icon name="link" />
  );
}
