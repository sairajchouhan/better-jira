/* oxlint-disable react/purity -- Snapshot the local minimum time on mount; validate against the current time on submit. */
import { useState } from "react";
import { Button } from "./button";
import { Field, TextInput } from "./field";

/** The custom future date/time step shared by snooze and reminders. Owns input, validation and Back. */
export function FutureTimeStep({
  label,
  inputLabel = label,
  submitLabel,
  errorMessage,
  onPick,
  onBack,
}: {
  label: string;
  inputLabel?: string;
  submitLabel: string;
  errorMessage: string;
  onPick: (at: string) => void;
  onBack: () => void;
}) {
  const [value, setValue] = useState(""),
    [error, setError] = useState(""),
    [min] = useState(() => {
      const now = new Date();
      return new Date(+now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    });
  return (
    <form
      noValidate
      className="w-[320px]"
      onSubmit={(event) => {
        event.preventDefault();
        const time = new Date(value).getTime();
        if (!(time > Date.now())) {
          setError(errorMessage);
          return;
        }
        onPick(new Date(time).toISOString());
      }}
    >
      <Field className="block p-2">
        <Field.Label className="block text-[13px]">{label}</Field.Label>
        <TextInput
          autoFocus
          required
          aria-label={inputLabel}
          type="datetime-local"
          min={min}
          value={value}
          aria-invalid={!!error || undefined}
          className="w-full mt-2"
          onChange={(event) => {
            setValue(event.target.value);
            setError("");
          }}
        />
        <Field.Description role={error ? "alert" : undefined} className="text-[12px] text-danger">
          {error}
        </Field.Description>
      </Field>
      <div className="flex justify-end gap-2 p-2">
        <Button type="button" variant="borderless" size="medium" onClick={onBack}>Back</Button>
        <Button disabled={!value} type="submit" variant="primary" size="medium">{submitLabel}</Button>
      </div>
    </form>
  );
}
