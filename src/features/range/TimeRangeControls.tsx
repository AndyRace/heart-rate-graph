import { useEffect, useState, type FormEvent } from "react";
import type { RangeOrigin, TimeBand } from "../../domain/readings";
import { parseLocalDateTime } from "../../domain/local-date-time";
import {
  adjacentLocalDayRange,
  localTodayRange,
  zoomTimeRange,
  type TimeRangeResult,
} from "../../domain/time-range";
import { toLocalDateTimeInput } from "../../shared/format";

interface TimeRangeControlsProps {
  readonly range: TimeBand;
  readonly fullRange: TimeBand;
  readonly onCommit: (startMs: number, endMs: number, origin?: RangeOrigin) => void;
  readonly onReset?: () => void;
  readonly loading?: boolean;
  readonly disabled?: boolean;
}

export function TimeRangeControls({
  range,
  fullRange,
  onCommit,
  onReset,
  loading = false,
  disabled = false,
}: TimeRangeControlsProps) {
  const [start, setStart] = useState(toLocalDateTimeInput(range.startMs));
  const [end, setEnd] = useState(toLocalDateTimeInput(range.endMs));
  const [errors, setErrors] = useState<{ start?: string; end?: string }>({});
  const [startChoice, setStartChoice] = useState<number>();
  const [endChoice, setEndChoice] = useState<number>();
  const [ambiguous, setAmbiguous] = useState<{
    start?: readonly { instantMs: number; offsetMinutes: number }[];
    end?: readonly { instantMs: number; offsetMinutes: number }[];
  }>({});
  useEffect(() => {
    setStart(toLocalDateTimeInput(range.startMs));
    setEnd(toLocalDateTimeInput(range.endMs));
  }, [range]);

  const apply = (event: FormEvent) => {
    event.preventDefault();
    const parsedStart = parseLocalDateTime(start, fullRange);
    const parsedEnd = parseLocalDateTime(end, fullRange);
    const nextErrors: { start?: string; end?: string } = {};
    const selectedStart =
      parsedStart.status === "valid"
        ? parsedStart.instantMs
        : parsedStart.status === "ambiguous"
          ? startChoice
          : undefined;
    const selectedEnd =
      parsedEnd.status === "valid"
        ? parsedEnd.instantMs
        : parsedEnd.status === "ambiguous"
          ? endChoice
          : undefined;
    if (selectedStart === undefined)
      nextErrors.start =
        parsedStart.status === "ambiguous"
          ? "Choose an offset for this ambiguous time."
          : "Enter a valid time within the dataset.";
    if (selectedEnd === undefined)
      nextErrors.end =
        parsedEnd.status === "ambiguous"
          ? "Choose an offset for this ambiguous time."
          : "Enter a valid time within the dataset.";
    if (selectedStart !== undefined && selectedEnd !== undefined && selectedEnd < selectedStart)
      nextErrors.end = "End must be at or after start.";
    setAmbiguous({
      start: parsedStart.status === "ambiguous" ? parsedStart.choices : undefined,
      end: parsedEnd.status === "ambiguous" ? parsedEnd.choices : undefined,
    });
    setErrors(nextErrors);
    if (
      !nextErrors.start &&
      !nextErrors.end &&
      selectedStart !== undefined &&
      selectedEnd !== undefined
    )
      onCommit(selectedStart, selectedEnd);
  };

  const commitResult = (result: TimeRangeResult) => {
    if (result.ok) onCommit(result.range.startMs, result.range.endMs, result.range.origin);
  };

  const commitToday = () => {
    const today = localTodayRange();
    onCommit(
      Number(today.startInstantNs / 1_000_000n),
      Number(today.endInstantNs / 1_000_000n),
      "today",
    );
  };

  const reset = () => {
    if (onReset) onReset();
    else onCommit(fullRange.startMs, fullRange.endMs, "reset");
  };

  const keyboardZoom = (key: string, target: EventTarget) => {
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;
    if (key === "+" || key === "=") commitResult(zoomTimeRange(fullRange, range, "in"));
    if (key === "-") commitResult(zoomTimeRange(fullRange, range, "out"));
  };
  return (
    <form
      className="range-controls"
      aria-labelledby="range-title"
      aria-busy={loading}
      onSubmit={apply}
      onKeyDown={(event) => keyboardZoom(event.key, event.target)}
    >
      <h2 id="range-title">Time range</h2>
      <div className="range-navigation" aria-label="Range navigation">
        <button
          type="button"
          className="secondary"
          onClick={() => commitResult(adjacentLocalDayRange(fullRange, range, "previous"))}
          disabled={disabled}
        >
          Previous day
        </button>
        <button type="button" className="secondary" onClick={commitToday} disabled={disabled}>
          Today
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => commitResult(adjacentLocalDayRange(fullRange, range, "next"))}
          disabled={disabled}
        >
          Next day
        </button>
      </div>
      <div className="range-navigation" aria-label="Zoom controls">
        <button
          type="button"
          className="secondary"
          onClick={() => commitResult(zoomTimeRange(fullRange, range, "in"))}
          disabled={disabled}
        >
          Zoom in
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => commitResult(zoomTimeRange(fullRange, range, "out"))}
          disabled={disabled}
        >
          Zoom out
        </button>
      </div>
      <label>
        Start
        <input
          type="datetime-local"
          value={start}
          onChange={(event) => setStart(event.target.value)}
          disabled={disabled}
          aria-invalid={Boolean(errors.start)}
          aria-describedby={errors.start ? "start-error" : undefined}
        />
      </label>
      {ambiguous.start && (
        <label>
          Start offset
          <select
            aria-label="Start offset"
            value={startChoice ?? ""}
            onChange={(event) => setStartChoice(Number(event.target.value))}
            disabled={disabled}
          >
            <option value="">Choose offset</option>
            {ambiguous.start.map((choice) => (
              <option key={choice.instantMs} value={choice.instantMs}>
                UTC{choice.offsetMinutes >= 0 ? "+" : ""}
                {choice.offsetMinutes / 60}
              </option>
            ))}
          </select>
        </label>
      )}
      {errors.start && (
        <span id="start-error" className="field-error">
          {errors.start}
        </span>
      )}
      <label>
        End
        <input
          type="datetime-local"
          value={end}
          onChange={(event) => setEnd(event.target.value)}
          disabled={disabled}
          aria-invalid={Boolean(errors.end)}
          aria-describedby={errors.end ? "end-error" : undefined}
        />
      </label>
      {ambiguous.end && (
        <label>
          End offset
          <select
            aria-label="End offset"
            value={endChoice ?? ""}
            onChange={(event) => setEndChoice(Number(event.target.value))}
            disabled={disabled}
          >
            <option value="">Choose offset</option>
            {ambiguous.end.map((choice) => (
              <option key={choice.instantMs} value={choice.instantMs}>
                UTC{choice.offsetMinutes >= 0 ? "+" : ""}
                {choice.offsetMinutes / 60}
              </option>
            ))}
          </select>
        </label>
      )}
      {errors.end && (
        <span id="end-error" className="field-error">
          {errors.end}
        </span>
      )}
      <div className="button-row">
        <button type="submit" disabled={disabled}>
          Apply range
        </button>
        <button type="button" className="secondary" onClick={reset} disabled={disabled}>
          Reset
        </button>
      </div>
    </form>
  );
}
