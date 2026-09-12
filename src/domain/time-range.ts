import type { RangeOrigin, TimeBand } from "./readings";

export type TimeRangeResult =
  | { readonly ok: true; readonly range: TimeBand }
  | { readonly ok: false; readonly field: "start" | "end"; readonly message: string };

export interface LocalCalendarClock {
  readonly now: () => Date;
  readonly localMidnight: (year: number, month: number, day: number) => number;
  readonly localDateParts?: (instantMs: number) => {
    readonly year: number;
    readonly month: number;
    readonly day: number;
  };
}

const systemLocalCalendar: LocalCalendarClock = {
  now: () => new Date(),
  localMidnight: (year, month, day) => new Date(year, month, day).getTime(),
  localDateParts: (instantMs) => {
    const date = new Date(instantMs);
    return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() };
  },
};

export function localTodayRange(clock: LocalCalendarClock = systemLocalCalendar): {
  readonly startInstantNs: bigint;
  readonly endInstantNs: bigint;
} {
  const now = clock.now();
  const parts = clock.localDateParts?.(now.getTime()) ?? {
    year: now.getFullYear(),
    month: now.getMonth(),
    day: now.getDate(),
  };
  const { year, month, day } = parts;
  const startMs = clock.localMidnight(year, month, day);
  const nextDate = new Date(year, month, day + 1);
  const nextMs = clock.localMidnight(
    nextDate.getFullYear(),
    nextDate.getMonth(),
    nextDate.getDate(),
  );
  return {
    startInstantNs: BigInt(startMs) * 1_000_000n,
    endInstantNs: BigInt(nextMs) * 1_000_000n - 1n,
  };
}

export function commitTimeRange(
  fullRange: Pick<TimeBand, "startMs" | "endMs">,
  currentRevision: number | undefined,
  startMs: number,
  endMs: number,
  origin: RangeOrigin,
): TimeRangeResult {
  if (!Number.isSafeInteger(startMs) || startMs < fullRange.startMs || startMs > fullRange.endMs)
    return { ok: false, field: "start", message: "Start must be within the dataset range." };
  if (!Number.isSafeInteger(endMs) || endMs < startMs)
    return { ok: false, field: "end", message: "End must be at or after start." };
  if (endMs > fullRange.endMs)
    return { ok: false, field: "end", message: "End must be within the dataset range." };
  return { ok: true, range: { startMs, endMs, revision: (currentRevision ?? -1) + 1, origin } };
}

export function zoomTimeRange(
  fullRange: Pick<TimeBand, "startMs" | "endMs">,
  current: TimeBand,
  direction: "in" | "out",
  anchorMs = current.startMs + Math.floor((current.endMs - current.startMs) / 2),
): TimeRangeResult {
  const currentDuration = current.endMs - current.startMs;
  const targetDuration =
    direction === "in"
      ? Math.max(0, Math.floor(currentDuration / 2))
      : Math.min(fullRange.endMs - fullRange.startMs, currentDuration * 2);
  const center = direction === "in" ? anchorMs : current.startMs + Math.floor(currentDuration / 2);
  const centeredStart = center - Math.floor(targetDuration / 2);
  const [startMs, endMs] = clipDurationToRange(centeredStart, targetDuration, fullRange);
  return commitTimeRange(fullRange, current.revision, startMs, endMs, "nested");
}

export function adjacentLocalDayRange(
  fullRange: Pick<TimeBand, "startMs" | "endMs">,
  current: TimeBand,
  direction: "previous" | "next",
  clock: LocalCalendarClock = systemLocalCalendar,
): TimeRangeResult {
  const currentDate =
    clock.localDateParts?.(current.startMs) ?? systemLocalCalendar.localDateParts!(current.startMs);
  const offset = direction === "previous" ? -1 : 1;
  const target = addCalendarDays(currentDate, offset);
  const following = addCalendarDays(target, 1);
  const targetStartMs = clock.localMidnight(target.year, target.month, target.day);
  const targetEndMs = clock.localMidnight(following.year, following.month, following.day) - 1;
  return commitTimeRange(
    fullRange,
    current.revision,
    Math.max(targetStartMs, fullRange.startMs),
    Math.min(targetEndMs, fullRange.endMs),
    "nested",
  );
}

function clipDurationToRange(
  proposedStart: number,
  duration: number,
  fullRange: Pick<TimeBand, "startMs" | "endMs">,
): readonly [number, number] {
  let startMs = proposedStart;
  let endMs = startMs + duration;
  if (startMs < fullRange.startMs) {
    startMs = fullRange.startMs;
    endMs = startMs + duration;
  }
  if (endMs > fullRange.endMs) {
    endMs = fullRange.endMs;
    startMs = endMs - duration;
  }
  return [startMs, endMs];
}

function addCalendarDays(
  date: { readonly year: number; readonly month: number; readonly day: number },
  days: number,
): { readonly year: number; readonly month: number; readonly day: number } {
  const normalized = new Date(Date.UTC(date.year, date.month, date.day + days));
  return {
    year: normalized.getUTCFullYear(),
    month: normalized.getUTCMonth(),
    day: normalized.getUTCDate(),
  };
}
