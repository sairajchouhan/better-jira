/* oxlint-disable react/purity -- The menu's "now" is read once as it opens, as Linear computes its options when the menu opens. */
import { useEffect, useState } from "react";
import { Icon } from "@/client/components/icons";
import { Menu } from "@/client/components/menu";
import { defaultTimeOptions, menuTimeOptions, type TimeOption } from "@/shared/time-options";

/** Linear's search placeholder in every time menu (`fF.nlpSearchPlaceholder`). */
export const TIME_PLACEHOLDER = "Try: 4 pm, 2 days, in 5 weeks…";

type Parser = typeof import("./typed-time");
let loaded: Parser | undefined;
/** The typed-time parser (chrono) loads with the first time menu; until it has, the presets and Custom… still work. */
function useParser() {
  const [parser, setParser] = useState(loaded);
  useEffect(() => {
    if (parser) return;
    let active = true;
    import("./typed-time")
      .then((module) => {
        loaded = module;
        if (active) setParser(module);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [parser]);
  return parser;
}

function OptionItem({ option, query, onPick }: { option: TimeOption; query: string; onPick: (at: string) => void }) {
  return (
    <Menu.Item
      value={option.label}
      keywords={[...(option.keywords?.split(" ") ?? []), ...(query ? [query] : [])]}
      icon={<Icon name="clock" />}
      hint={<time dateTime={option.at}>{option.detail}</time>}
      onSelect={() => onPick(option.at)}
    >
      {option.label}
    </Menu.Item>
  );
}

/** The rows of every time menu: Linear's shared `_F` options (Remind me, Snooze). The presets a search finds by label or keyword
 *  ("1h", "tonight", "1w"), the typed time ("4 pm", "2 days") unless a preset is that time already, then Custom…. The typed row
 *  is valued by its ISO time and matches whatever was typed, so a filtering menu keeps it. `onPick` gets an ISO time. */
export function TimeOptionRows({
  query,
  onPick,
  onCustom,
}: {
  query: string;
  onPick: (at: string) => void;
  onCustom: () => void;
}) {
  const [now] = useState(() => new Date()),
    [presets] = useState(() => defaultTimeOptions(now)),
    parser = useParser();
  const { presets: matches, typed: extra } = menuTimeOptions(
    presets,
    query && parser ? parser.typedTimeOption(query, now) : null,
    query,
  );
  return (
    <>
      {extra && (
        <Menu.Item
          value={extra.at}
          keywords={[query]}
          icon={<Icon name="clock" />}
          hint={extra.detail}
          onSelect={() => onPick(extra.at)}
        >
          {extra.label}
        </Menu.Item>
      )}
      {matches.map((option) => (
        <OptionItem key={option.label} option={option} query={query} onPick={onPick} />
      ))}
      {/* Menu.Empty straight in the rows: it is a collection Header, and a plain element between collection rows breaks React
          Aria's collection (no rows, then a render loop as the next keystroke lands). */}
      {query && !extra && !matches.length && <Menu.Empty always>Choose a future date and time</Menu.Empty>}
      <Menu.Item value="Custom…" keywords={query ? [query] : undefined} icon={<Icon name="clock" />} onSelect={onCustom}>
        Custom…
      </Menu.Item>
    </>
  );
}
