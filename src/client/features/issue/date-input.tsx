import { Text } from "@/client/components/text";
import { TextInput } from "@/client/components/field";
import { Button } from "@/client/components/button";
import { useState } from "react";
import { parseDueDate } from "@/client/lib/due-parse";

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
    <Text className="space-y-2" as="div" variant="mini" color="inherit">
      <TextInput
        autoFocus={autoFocus}
        aria-label="Due date"
        aria-invalid={!valid}
        autoComplete="off"
        placeholder="Tomorrow, next Monday, in 2 weeks…"
        value={text}
        onChange={(e) => change(e.target.value)}
        className="w-full"
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
          <Button
            key={preset}
            type="button"
            onClick={() => change(preset)}
            variant="borderless"
            size="small"
          >
            {preset}
          </Button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-fg-3">
        Calendar
        <TextInput
          type="date"
          aria-label="Choose calendar date"
          value={parsed ?? ""}
          onChange={(e) => change(e.target.value)}
          className="min-w-0"
        />
      </label>
    </Text>
  );
}
