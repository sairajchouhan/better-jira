import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FutureTimeStep } from "./future-time-step";

const input = (html: string) => html.match(/<input [^>]*>/)![0];

test("the custom time's input is named by its own label: aria-label, with no aria-labelledby to outrank it", () => {
  const html = renderToStaticMarkup(
    <FutureTimeStep
      label="Custom reminder"
      inputLabel="Custom reminder time"
      submitLabel="Set reminder"
      errorMessage="Choose a future reminder time"
      onPick={() => {}}
      onBack={() => {}}
    />,
  );
  expect(input(html)).toContain('aria-label="Custom reminder time"');
  expect(input(html)).not.toContain("aria-labelledby");
  expect(html).toContain(">Custom reminder<");
});

test("without an input label the input takes the step's label", () => {
  const html = renderToStaticMarkup(
    <FutureTimeStep label="Snooze until" submitLabel="Snooze" errorMessage="x" onPick={() => {}} onBack={() => {}} />,
  );
  expect(input(html)).toContain('aria-label="Snooze until"');
  expect(input(html)).not.toContain("aria-labelledby");
});
