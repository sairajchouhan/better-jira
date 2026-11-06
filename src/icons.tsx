/** Linear's workflow-state icon, copied from its DOM (linear.app board, 2026-11-06).
 *  Ring r=6; progress pie r=2 stroke 4, dash 12.19 shifted by (1 - progress); done fills r=3 and cuts a check. */
type Look = { color: string; progress?: number; dashed?: true; done?: "check" | "x" };
const LOOKS: [RegExp, Look][] = [
  [/backlog/i, { color: "var(--st-backlog)", dashed: true }],
  [/archived|cancel|won't/i, { color: "var(--st-canceled)", done: "x" }],
  [/ready to deploy/i, { color: "var(--st-review)", done: "check" }],
  [/progress|sre/i, { color: "var(--st-progress)", progress: 0.5 }],
  [/review/i, { color: "var(--st-review)", progress: 0.75 }],
  [/qa/i, { color: "var(--st-qa)", progress: 0.75 }],
  [/hold|awaiting/i, { color: "var(--st-hold)", progress: 0.25 }],
];
const BY_CATEGORY: Record<string, Look> = {
  new: { color: "var(--st-todo)" },
  indeterminate: { color: "var(--st-progress)", progress: 0.5 },
  done: { color: "var(--st-done)", done: "check" },
};
const PIE = 12.189379495928398;
const CHECK = "M10.951 4.24896C11.283 4.58091 11.283 5.11909 10.951 5.45104L5.95104 10.451C5.61909 10.783 5.0809 10.783 4.74896 10.451L2.74896 8.45104C2.41701 8.11909 2.41701 7.5809 2.74896 7.24896C3.0809 6.91701 3.61909 6.91701 3.95104 7.24896L5.35 8.64792L9.74896 4.24896C10.0809 3.91701 10.6191 3.91701 10.951 4.24896Z";

export function StatusIcon({ status }: { status: { name: string; category: string } }) {
  const l = LOOKS.find(([re]) => re.test(status.name))?.[1] ?? BY_CATEGORY[status.category] ?? BY_CATEGORY.new!;
  const c = l.color;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
      <circle cx="7" cy="7" r="6" stroke={c} strokeWidth="1.5" strokeDasharray={l.dashed ? "1.4 1.74" : "3.14 0"} strokeDashoffset={l.dashed ? 0.65 : -0.7} />
      {l.done ? (
        <>
          <circle cx="7" cy="7" r="3" stroke={c} strokeWidth="6" strokeDasharray="18.84955592153876 37.69911184307752" transform="rotate(-90 7 7)" />
          {l.done === "check" ? <path fill="var(--panel)" d={CHECK} /> : <path d="M5 5l4 4M9 5l-4 4" stroke="var(--panel)" strokeWidth="1.6" strokeLinecap="round" />}
        </>
      ) : (
        <circle cx="7" cy="7" r="2" stroke={c} strokeWidth="4" strokeDasharray={`${PIE} ${PIE * 2}`} strokeDashoffset={PIE * (1 - (l.progress ?? 0))} transform="rotate(-90 7 7)" />
      )}
    </svg>
  );
}

/** Linear's priority icons (16px, copied from its DOM); Jira's priority names collapse into its 5 levels. */
export function PriorityIcon({ name }: { name?: string }) {
  const p = name ?? "";
  if (/highest|critical|showstopper|blocker/i.test(p))
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" className="shrink-0">
        <rect x="1" y="1" width="14" height="14" rx="3" fill="#f2994a" />
        <path d="M8 4.5v4.5M8 11.2v.3" stroke="var(--panel)" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  const level = /high|major/i.test(p) ? 3 : /medium|normal/i.test(p) ? 2 : /low|minor|trivial/i.test(p) ? 1 : 0;
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
      {level === 0
        ? [1.5, 6.5, 11.5].map((x) => <rect key={x} x={x} y="7.25" width="3" height="1.5" rx="0.5" opacity="0.9" />)
        : [[1.5, 8, 6], [6.5, 5, 9], [11.5, 2, 12]].map(([x, y, h], i) => <rect key={x} x={x} y={y} width="3" height={h} rx="1" fillOpacity={i < level ? 1 : 0.4} />)}
    </svg>
  );
}

const TYPE_COLOR: Record<string, string> = {
  Bug: "#eb5757", Story: "#4cb782", Task: "#4ea7fc", Epic: "#bb87fc", "Sub-task": "#26b5ce",
  Spike: "#f2994a", Design: "#e88fcf", Initiative: "#f2c94c",
};
export const TypeDot = ({ type }: { type?: string }) => (
  <span title={type} className="size-2 shrink-0 rounded-[2px]" style={{ background: TYPE_COLOR[type ?? ""] ?? "var(--fg-4)" }} />
);

const LABEL_COLORS = ["#eb5757", "#f2994a", "#f2c94c", "#4cb782", "#26b5ce", "#4ea7fc", "#bb87fc", "#e88fcf"];
const hue = (s: string) => LABEL_COLORS[[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % LABEL_COLORS.length];
/** Linear's label chip: 24px pill, 0.5px border, 9px dot in a 14px box, 12px/450 muted text. */
export const Label = ({ name }: { name: string }) => (
  <span title={name} className="flex h-6 max-w-[224px] shrink-0 items-center rounded-full border-[0.5px] border-chip-line bg-card px-2 text-[12px] font-[450] text-card-fg-3">
    <span className="grid size-3.5 shrink-0 place-items-center"><span className="size-[9px] rounded-full" style={{ background: hue(name) }} /></span>
    <span className="mr-px ml-1.5 truncate">{name}</span>
  </span>
);

const PATHS = {
  search: "M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM14 14l-3.5-3.5",
  expand: "M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9",
  close: "M4 4l8 8M12 4l-8 8",
  up: "M8 13V3M4 7l4-4 4 4",
  down: "M8 3v10M4 9l4 4 4-4",
  check: "M3.5 8.5l3 3 6-7",
  comment: "M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z",
  external: "M9 2.5h4.5V7M13.5 2.5 7 9M11.5 9.5v3.5h-9v-9H6",
  pencil: "M10.5 2.5l3 3-8 8h-3v-3z",
};
// Filled glyphs copied from Linear's live SVGs (evenodd fill, not stroke).
const FILLED = {
  dots: "M3 6.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z",
  filter: "M14.25 3a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1 0-1.5h12.5ZM4 8a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 4 8Zm2.75 3.5a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z",
  plus: "M8.75 4C8.75 3.58579 8.41421 3.25 8 3.25C7.58579 3.25 7.25 3.58579 7.25 4V7.25H4C3.58579 7.25 3.25 7.58579 3.25 8C3.25 8.41421 3.58579 8.75 4 8.75H7.25V12C7.25 12.4142 7.58579 12.75 8 12.75C8.41421 12.75 8.75 12.4142 8.75 12V8.75H12C12.4142 8.75 12.75 8.41421 12.75 8C12.75 7.58579 12.4142 7.25 12 7.25H8.75V4Z",
  side: "M4.25 2C2.45508 2 1 3.45508 1 5.25V10.75C1 12.5449 2.45508 14 4.25 14H11.75C13.5449 14 15 12.5449 15 10.75V5.25C15 3.45508 13.5449 2 11.75 2H4.25ZM2.5 5.5C2.5 4.39543 3.39543 3.5 4.5 3.5H11.5C12.6046 3.5 13.5 4.39543 13.5 5.5V10.5C13.5 11.6046 12.6046 12.5 11.5 12.5H4.5C3.39543 12.5 2.5 11.6046 2.5 10.5V5.5ZM10.75 5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5a.75.75 0 0 1 .75-.75Z",
};
export const Icon = ({ name, size = 14 }: { name: keyof typeof PATHS | keyof typeof FILLED; size?: number }) =>
  name in FILLED ? (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
      <path fillRule="evenodd" clipRule="evenodd" d={FILLED[name as keyof typeof FILLED]} />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d={PATHS[name as keyof typeof PATHS]} />
    </svg>
  );
