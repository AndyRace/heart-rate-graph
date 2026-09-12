import { describe, expect, it } from "vitest";
import {
  adjacentLocalDayRange,
  commitTimeRange,
  localTodayRange,
  zoomTimeRange,
} from "../../src/domain/time-range";

describe("time ranges", () => {
  it("commits inclusive ranges and increments revisions", () => {
    expect(commitTimeRange({ startMs: 0, endMs: 100 }, undefined, 10, 10, "fields")).toEqual({
      ok: true,
      range: { startMs: 10, endMs: 10, revision: 0, origin: "fields" },
    });
    expect(commitTimeRange({ startMs: 0, endMs: 100 }, 4, 20, 80, "nested")).toMatchObject({
      ok: true,
      range: { revision: 5 },
    });
  });

  it("rejects reversed or out-of-dataset ranges", () => {
    expect(commitTimeRange({ startMs: 0, endMs: 100 }, 0, 80, 20, "fields").ok).toBe(false);
    expect(commitTimeRange({ startMs: 0, endMs: 100 }, 0, -1, 20, "fields").ok).toBe(false);
  });

  it("builds today from consecutive injected local midnights, including a 23-hour day", () => {
    const midnightCalls: number[][] = [];
    const startMs = Date.UTC(2024, 2, 10, 5);
    const nextMs = Date.UTC(2024, 2, 11, 4);
    const result = localTodayRange({
      now: () => new Date(2024, 2, 10, 12),
      localMidnight: (year, month, day) => {
        midnightCalls.push([year, month, day]);
        return midnightCalls.length === 1 ? startMs : nextMs;
      },
    });

    expect(midnightCalls).toEqual([
      [2024, 2, 10],
      [2024, 2, 11],
    ]);
    expect(result).toEqual({
      startInstantNs: BigInt(startMs) * 1_000_000n,
      endInstantNs: BigInt(nextMs) * 1_000_000n - 1n,
    });
  });

  it("builds today from consecutive injected local midnights on an ordinary 24-hour day", () => {
    const startMs = Date.UTC(2024, 5, 10);
    const nextMs = Date.UTC(2024, 5, 11);
    const result = localTodayRange({
      now: () => new Date(2024, 5, 10, 15),
      localMidnight: (_year, _month, day) => (day === 10 ? startMs : nextMs),
    });

    expect(nextMs - startMs).toBe(24 * 60 * 60 * 1000);
    expect(result).toEqual({
      startInstantNs: BigInt(startMs) * 1_000_000n,
      endInstantNs: BigInt(nextMs) * 1_000_000n - 1n,
    });
  });

  it("builds today from consecutive injected local midnights across a 25-hour fall-back day", () => {
    const midnightCalls: number[][] = [];
    const startMs = Date.UTC(2024, 10, 3, 4);
    const nextMs = Date.UTC(2024, 10, 4, 5);
    const result = localTodayRange({
      now: () => new Date(2024, 10, 3, 12),
      localMidnight: (year, month, day) => {
        midnightCalls.push([year, month, day]);
        return midnightCalls.length === 1 ? startMs : nextMs;
      },
    });

    expect(nextMs - startMs).toBe(25 * 60 * 60 * 1000);
    expect(midnightCalls).toEqual([
      [2024, 10, 3],
      [2024, 10, 4],
    ]);
    expect(result).toEqual({
      startInstantNs: BigInt(startMs) * 1_000_000n,
      endInstantNs: BigInt(nextMs) * 1_000_000n - 1n,
    });
  });

  it("zooms in around the supplied anchor and zooms out reciprocally around the midpoint", () => {
    const fullRange = { startMs: 0, endMs: 1_000 };
    const current = { startMs: 200, endMs: 600, revision: 4, origin: "fields" as const };

    expect(zoomTimeRange(fullRange, current, "in", 300)).toEqual({
      ok: true,
      range: { startMs: 200, endMs: 400, revision: 5, origin: "nested" },
    });
    expect(zoomTimeRange(fullRange, current, "out")).toEqual({
      ok: true,
      range: { startMs: 0, endMs: 800, revision: 5, origin: "nested" },
    });
  });

  it("clips zoom domains without changing their deterministic duration", () => {
    const result = zoomTimeRange(
      { startMs: 0, endMs: 1_000 },
      { startMs: 0, endMs: 400, revision: 0, origin: "fields" },
      "out",
    );
    expect(result).toMatchObject({ ok: true, range: { startMs: 0, endMs: 800 } });
  });

  it("navigates by adjacent local calendar midnights rather than fixed durations", () => {
    const calls: number[][] = [];
    const current = {
      startMs: Date.UTC(2024, 2, 10, 5),
      endMs: Date.UTC(2024, 2, 11, 4) - 1,
      revision: 2,
      origin: "today" as const,
    };
    const result = adjacentLocalDayRange(
      { startMs: Date.UTC(2024, 2, 8), endMs: Date.UTC(2024, 2, 14) },
      current,
      "next",
      {
        now: () => new Date(),
        localMidnight: (year, month, day) => {
          calls.push([year, month, day]);
          return calls.length === 1 ? Date.UTC(2024, 2, 11, 4) : Date.UTC(2024, 2, 12, 4);
        },
        localDateParts: () => ({ year: 2024, month: 2, day: 10 }),
      },
    );

    expect(calls).toEqual([
      [2024, 2, 11],
      [2024, 2, 12],
    ]);
    expect(result).toEqual({
      ok: true,
      range: {
        startMs: Date.UTC(2024, 2, 11, 4),
        endMs: Date.UTC(2024, 2, 12, 4) - 1,
        revision: 3,
        origin: "nested",
      },
    });
  });

  it("clips an adjacent calendar day to the available source extent", () => {
    const dayStart = Date.UTC(2024, 5, 10);
    const firstReading = dayStart + 3_600_000;
    const lastReading = dayStart + 20 * 3_600_000;
    const result = adjacentLocalDayRange(
      { startMs: firstReading, endMs: lastReading },
      {
        startMs: Date.UTC(2024, 5, 11),
        endMs: Date.UTC(2024, 5, 12) - 1,
        revision: 0,
        origin: "today",
      },
      "previous",
    );

    expect(result).toEqual({
      ok: true,
      range: {
        startMs: firstReading,
        endMs: lastReading,
        revision: 1,
        origin: "nested",
      },
    });
  });
});
