import { useState } from "react";
import { parseDueDate } from "./due-parse";

export function DateInput({
  value,
  onChange,
  onValidity,
  autoFocus,
}: {
  value: string;
  onChange: (date: string) => void;
  onValidity?: (valid: boolean) => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(value),
    parsed = parseDueDate(text),
    valid = !text.trim() || !!parsed;
  const change = (next: string) => {
    setText(next);
    const date = parseDueDate(next);
    onValidity?.(!next.trim() || !!date);
    if (date || !next.trim()) onChange(date ?? "");
  };
  return (
    <div className="space-y-2 text-[12px]">
      <input
        autoFocus={autoFocus}
        aria-label="Due date"
        aria-invalid={!valid}
        autoComplete="off"
        placeholder="Tomorrow, next Monday, in 2 weeks…"
        value={text}
        onChange={(e) => change(e.target.value)}
        className="w-full rounded-md border border-line-2 bg-card px-3 py-2 text-fg outline-none focus:border-accent"
      />
      <div role="status" className="min-h-4 text-fg-3">
        {parsed
          ? new Date(`${parsed}T12:00:00`).toLocaleDateString(undefined, {
              weekday: "long",
              year: "numeric",
              month: "short",
              day: "numeric",
            })
          : valid
            ? "Type a date or choose below"
            : "Enter a complete date, such as next Monday"}
      </div>
      <div className="flex flex-wrap gap-1">
        {["Today", "Tomorrow", "Next Monday", "End of week"].map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => change(preset)}
            className="rounded-md px-2 py-1 text-fg-3 hover:bg-hover"
          >
            {preset}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-fg-3">
        Calendar
        <input
          type="date"
          aria-label="Choose calendar date"
          value={parsed ?? ""}
          onChange={(e) => change(e.target.value)}
          className="min-w-0 rounded-md border border-line-2 bg-card px-2 py-1"
        />
      </label>
    </div>
  );
}
