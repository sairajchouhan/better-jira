import { use, useState } from "react";
import {
  Button,
  Calendar as AriaCalendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  CalendarStateContext,
  useLocale,
} from "react-aria-components";
import { getLocalTimeZone, isSameDay, isSameMonth, isWeekend, parseDate, startOfMonth, today, type CalendarDate } from "@internationalized/date";
import { IconButton } from "./button";
import { Icon } from "./icons";
import "./calendar.css";

/**
 * Linear's two-month DatePicker (`Gwt` over react-day-picker, styles `_datePicker_rzslo_1`) as the issue due-date dialog
 * (`r3t`) shows it: six fixed weeks per month, outside days hidden, weekends banded, today ringed, the chosen day filled,
 * the typed preview circled. The first month's caption is only its name; the second's carries Jump to today (while today
 * is off screen), Previous month and Next month, each moving one month (`Ywt`/`Xwt`). Behaviour and keyboard are React
 * Aria's Calendar. Dates in and out are ISO dates ("2026-11-15").
 */
export const CALENDAR = { MONTHS: 2, WEEKS: 6 } as const;

/** An ISO date as a calendar date, or null when it isn't one. */
export function calendarDate(iso: string | null | undefined): CalendarDate | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  try {
    return parseDate(iso);
  } catch {
    return null;
  }
}

/** Linear's `Xwt`: no Jump to today while today's month is on screen; else its arrow points the way today lies. */
export function jumpDirection(first: CalendarDate, now: CalendarDate): "back" | "forward" | null {
  const second = startOfMonth(first).add({ months: 1 });
  if (isSameMonth(first, now) || isSameMonth(second, now)) return null;
  return second.compare(now) < 0 ? "forward" : "back";
}

type Shown = {
  /** The date the calendar opens on, its month first (`defaultMonth`). */
  focus: CalendarDate;
  /** The preview's month it last followed (`alwaysSyncDefaultMonth`). */
  synced: string | null;
  /** Bumped to reopen the calendar on `focus`; React Aria's Calendar only aligns its months when it mounts. */
  generation: number;
  /** A jump to today moves focus to today's cell, as the jump button leaves the screen. */
  autoFocus: boolean;
};

export function Calendar({
  label,
  value,
  highlighted,
  onChange,
}: {
  label: string;
  value: string | null;
  /** The date being typed, circled and followed (Linear's `highlighted` modifier and `defaultMonth`). */
  highlighted?: string | null;
  onChange: (iso: string) => void;
}) {
  const selected = calendarDate(value);
  const preview = calendarDate(highlighted);
  const previewMonth = preview ? preview.toString().slice(0, 7) : null;
  const [shown, setShown] = useState<Shown>(() => ({
    focus: preview ?? selected ?? today(getLocalTimeZone()),
    synced: previewMonth,
    generation: 0,
    autoFocus: false,
  }));
  // A new preview month brings the calendar to it (state adjusted during render, not in an effect).
  if (preview && previewMonth !== shown.synced)
    setShown({ focus: preview, synced: previewMonth, generation: shown.generation + 1, autoFocus: false });
  return (
    <AriaCalendar
      key={shown.generation}
      aria-label={label}
      value={selected}
      onChange={(date) => onChange(date.toString())}
      defaultFocusedValue={shown.focus}
      autoFocus={shown.autoFocus}
      visibleDuration={{ months: CALENDAR.MONTHS }}
      pageBehavior="single"
      selectionAlignment="start"
      weeksInMonth={CALENDAR.WEEKS}
      className="ui-calendar"
    >
      <div className="ui-calendar-months">
        <Month offset={0} highlighted={preview} />
        <Month
          offset={1}
          highlighted={preview}
          onJump={(now) => setShown((s) => ({ ...s, focus: now, generation: s.generation + 1, autoFocus: true }))}
        />
      </div>
    </AriaCalendar>
  );
}

/** One month: its caption and its grid (`rdp-month`). */
function Month({
  offset,
  highlighted,
  onJump,
}: {
  offset: number;
  highlighted: CalendarDate | null;
  /** Given on the month whose caption carries the navigation. */
  onJump?: (today: CalendarDate) => void;
}) {
  const state = use(CalendarStateContext);
  const { locale } = useLocale();
  if (!state) return null;
  const first = state.visibleRange.start;
  const month = startOfMonth(first).add({ months: offset });
  const now = today(state.timeZone);
  const jump = jumpDirection(first, now);
  // Linear formats captions in en-US whatever the locale ("November 2026").
  const caption = month.toDate(state.timeZone).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return (
    <div className="ui-calendar-month">
      <div className="ui-calendar-caption">
        <span className="ui-calendar-caption-label">{caption}</span>
        {onJump && (
          <div className="ui-calendar-nav">
            {jump && (
              <IconButton label="Jump to today" data-mirror={jump === "forward" || undefined} onClick={() => onJump(now)}>
                <Icon name="arrow-left" size={16} />
              </IconButton>
            )}
            <NavButton slot="previous" label="Previous month" mirror />
            <NavButton slot="next" label="Next month" />
          </div>
        )}
      </div>
      <CalendarGrid offset={{ months: offset }} weekdayStyle="short" className="ui-calendar-grid">
        {/* react-day-picker's weekday names ("Su", "Mo", date-fns `cccccc`). */}
        <CalendarGridHeader>{(day) => <CalendarHeaderCell>{day.slice(0, 2)}</CalendarHeaderCell>}</CalendarGridHeader>
        <CalendarGridBody>
          {(date) => {
            const inMonth = isSameMonth(date, month);
            return (
              <CalendarCell
                date={date}
                data-weekend={(inMonth && isWeekend(date, locale)) || undefined}
                data-highlighted={(inMonth && !!highlighted && isSameDay(date, highlighted)) || undefined}
                className="ui-calendar-day"
              />
            );
          }}
        </CalendarGridBody>
      </CalendarGrid>
    </div>
  );
}

/** Linear's `Jx` (our IconButton's look: borderless, medium, icon-only) as React Aria's previous/next slot button. */
function NavButton({ slot, label, mirror }: { slot: "previous" | "next"; label: string; mirror?: boolean }) {
  return (
    <Button
      slot={slot}
      aria-label={label}
      // A press keeps focus where it is, in the field (Linear's calendar prevents mousedown).
      preventFocusOnPress
      data-variant="borderless"
      data-size="medium"
      data-shape="icon"
      data-mirror={mirror || undefined}
      className="ui-button"
    >
      <span aria-hidden className="ui-button-icon">
        <Icon name="chevron-right" size={16} />
      </span>
    </Button>
  );
}
