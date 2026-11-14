import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { renderWithFakeDocument } from "@/client/test/fake-document";
import { VideoSlider } from "./video-player";

const render = (props: Partial<Parameters<typeof VideoSlider>[0]> = {}) =>
  renderWithFakeDocument(() =>
    renderToStaticMarkup(
      <VideoSlider aria-label="Volume" className="video-volume-slider" minValue={0} maxValue={1} value={0.45} {...props} />,
    ),
  );

test("a video slider is React Aria's labelled group around a track, its gradient stop at the value, and a range input", () => {
  const html = render({ orientation: "vertical", step: 0.05, formatOptions: { style: "percent" } });
  expect(html).toMatch(/^<div [^>]*role="group"[^>]*aria-label="Volume"/);
  expect(html).toContain('class="video-slider video-volume-slider"');
  expect(html).toContain("--video-progress:45%");
  const input = /<input [^>]*>/.exec(html)?.[0] ?? "";
  for (const attribute of ['type="range"', 'step="0.05"', 'value="0.45"', 'aria-orientation="vertical"', 'aria-valuetext="45%"'])
    expect(input).toContain(attribute);
});

test("the seek slider reads its value in seconds and is out of reach while disabled", () => {
  const html = render({
    "aria-label": "Seek slider",
    className: "video-seek",
    maxValue: 4,
    value: 2,
    isDisabled: true,
    formatOptions: { style: "unit", unit: "second", unitDisplay: "long", maximumFractionDigits: 0 },
  });
  const input = /<input [^>]*>/.exec(html)?.[0] ?? "";
  expect(input).toContain('aria-valuetext="2 seconds"');
  expect(input).toContain('disabled=""');
});
