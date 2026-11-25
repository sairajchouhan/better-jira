import type { ComponentProps, CSSProperties } from "react";
import "./control-tokens.css";
import "./loader.css";

/**
 * Linear's GridLoaderIcon (`Fv` / `.gli` in startup-root.CnUSfl4j.js):
 * animated dot-matrix sprites used across Linear for every loading state:
 * - `scope`: searchable lists, menus, filter panels (`Qw.gridLoaderIcon`)
 * - `pong`: buttons, inline actions, connecting (`Lv` LoadingButton)
 * - `hourglass`: workspace & board background syncing (`xqn`, "Still setting up your workspace")
 * - `outlines`: subtle inline / row spinner
 * - `down`: loading older / more items
 */
export type GridLoaderVariant = "scope" | "pong" | "hourglass" | "outlines" | "down";
export type GridLoaderSize = "regular" | "small" | "tiny";

type GridSpec = { iconSize: number; dots: { cx: number; cy: number; mask: number }[] };

const DOT_RADIUS = 1;
const DOT_PITCH = 3.5;

function makeGrid(count: number, iconSize: number): GridSpec {
  const span = 2 + DOT_PITCH * (count - 1);
  const offset = Math.floor(iconSize - span) / 2;
  return {
    iconSize,
    dots: Array.from({ length: count * count }, (_, index) => ({
      cx: offset + DOT_RADIUS + (index % count) * DOT_PITCH,
      cy: offset + DOT_RADIUS + Math.floor(index / count) * DOT_PITCH,
      mask: 2 ** index,
    })),
  };
}

const GRID_5 = makeGrid(5, 16);
const GRID_4 = makeGrid(4, 14);
const GRID_3 = makeGrid(3, 10);

// Exact frame bitmasks from Linear's `dDe` (5x5), `pDe` (4x4), and `mDe` (3x3).
const FRAMES_5: Record<GridLoaderVariant, readonly number[]> = {
  scope: [4657152, 2328576, 72768, 2274, 7335, 0, 7335, 0, 4548, 9096, 291072, 9314304],
  pong: [577056, 17482784, 25740320, 17482784, 17320993, 542369, 17977, 50864],
  hourglass: [15012302, 15143246, 13532326, 915296, 6487948],
  outlines: [31457295, 15728670, 7373340, 3196440, 1623600, 17352225, 25707555, 29884455],
  down: [4194308, 142, 4548, 145540, 4657280, 14815232, 4325376],
};

const FRAMES_4: Partial<Record<GridLoaderVariant, readonly number[]>> = {
  scope: [20032, 10016, 626, 1879, 0, 1879, 0, 1252],
  pong: [2195, 2257, 35600, 51472, 2960, 2257],
  outlines: [57351, 28686, 12684, 6552, 35217, 51219],
};

const FRAMES_3: Partial<Record<GridLoaderVariant, readonly number[]>> = {
  scope: [1, 2, 4, 32, 256, 128, 64, 8, 1, 495, 0, 495, 0],
  outlines: [7, 38, 292, 416, 448, 200, 73, 11],
};

const PIXELS: Record<GridLoaderSize, number> = { regular: 16, small: 14, tiny: 10 };

function resolveSpec(variant: GridLoaderVariant, size: GridLoaderSize): { grid: GridSpec; frames: readonly number[] } {
  if (size === "tiny" && FRAMES_3[variant]) return { grid: GRID_3, frames: FRAMES_3[variant]! };
  if (size === "small" && FRAMES_4[variant]) return { grid: GRID_4, frames: FRAMES_4[variant]! };
  return { grid: GRID_5, frames: FRAMES_5[variant] };
}

/** Linear's animated dot-matrix loader (`Fv` / `.gli`). Inherits `currentColor` for crisp dark & light rendering. */
export function GridLoader({
  variant = "scope",
  size = "small",
  interval = 200,
  label,
  className = "",
  style,
}: {
  variant?: GridLoaderVariant;
  size?: GridLoaderSize;
  /** Milliseconds per frame (Linear default: 200ms). */
  interval?: number;
  /** Accessible label; omit when adjacent text already describes the loading state. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const { grid, frames } = resolveSpec(variant, size);
  const px = PIXELS[size];
  const stride = grid.iconSize;
  const duration = frames.length * interval;
  const stripStyle = {
    "--ui-gli-shift": `${-frames.length * stride}px`,
    animationDuration: `${duration}ms`,
    animationTimingFunction: `steps(${frames.length}, end)`,
  } as CSSProperties;

  return (
    <svg
      width={px}
      height={px}
      viewBox={`0 0 ${grid.iconSize} ${grid.iconSize}`}
      fill="currentColor"
      aria-hidden={label ? undefined : true}
      role={label ? "status" : undefined}
      aria-label={label}
      data-loader-variant={variant}
      className={`ui-gli ${className}`}
      style={style}
    >
      <g className="ui-gli-strip" style={stripStyle}>
        {frames.map((mask, frameIndex) => (
          <g key={frameIndex} transform={frameIndex ? `translate(${frameIndex * stride}, 0)` : undefined}>
            {grid.dots.map((dot, dotIndex) => (
              <circle
                key={dotIndex}
                cx={dot.cx}
                cy={dot.cy}
                r={DOT_RADIUS}
                opacity={(mask & dot.mask) !== 0 ? 1 : 0.3}
              />
            ))}
          </g>
        ))}
      </g>
    </svg>
  );
}

/** Linear's shimmer skeleton block (`vk` / `nct` in startup-root). */
export function Skeleton({
  width,
  height = 12,
  rounded,
  className = "",
  style,
  ...props
}: {
  width?: number | string;
  height?: number | string;
  rounded?: number | string;
} & ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={`ui-skeleton ${className}`}
      style={{
        width,
        height,
        ...(rounded !== undefined ? { borderRadius: rounded } : {}),
        ...style,
      }}
      {...props}
    />
  );
}
