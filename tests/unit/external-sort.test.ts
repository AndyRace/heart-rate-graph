import { describe, expect, it } from "vitest";
import { MAX_CHUNK_ROWS, MAX_STAGING_RUN_ROWS } from "../../src/domain/readings";
import { createStagingRuns, mergeStagingRuns } from "../../src/worker/external-sort";

describe("external reading sort", () => {
  it("bounds runs and chunks while sorting by exact nanoseconds then source order", () => {
    const rows = Array.from({ length: MAX_STAGING_RUN_ROWS + 1 }, (_, sourceOrder) => ({
      instantNs: BigInt(MAX_STAGING_RUN_ROWS - sourceOrder),
      endInstantNs: BigInt(MAX_STAGING_RUN_ROWS - sourceOrder + 10),
      bpm: 60 + (sourceOrder % 40),
      source: "watch",
      sourceOrder,
    }));
    const runs = createStagingRuns("generation", rows);
    expect(runs.map((run) => run.rowCount)).toEqual([MAX_STAGING_RUN_ROWS, 1]);

    const merged = mergeStagingRuns("generation", runs);
    expect(merged.chunks.every((chunk) => chunk.rowCount <= MAX_CHUNK_ROWS)).toBe(true);
    expect(merged.acceptedCount).toBe(rows.length);
    expect(merged.readings[0]).toMatchObject({ instantNs: 0n, endInstantNs: 10n });
  });

  it("deduplicates the complete start/end/bpm/source tuple across run boundaries", () => {
    const duplicate = {
      instantNs: 10n,
      endInstantNs: 20n,
      bpm: 72,
      source: "watch",
    };
    const runs = createStagingRuns(
      "generation",
      [
        { ...duplicate, sourceOrder: 5 },
        { ...duplicate, sourceOrder: 1 },
        { ...duplicate, endInstantNs: 21n, sourceOrder: 6 },
      ],
      1,
    );
    const merged = mergeStagingRuns("generation", runs, 1);

    expect(merged.duplicateCount).toBe(1);
    expect(merged.readings.map((row) => row.sourceOrder)).toEqual([1, 6]);
    expect(merged.readings.map((row) => row.endInstantNs)).toEqual([20n, 21n]);
    expect(merged.acceptedCount + merged.duplicateCount).toBe(3);
  });

  it("produces a globally ordered merge across many staging runs", () => {
    const total = 500;
    const rows = Array.from({ length: total }, (_, index) => ({
      instantNs: BigInt((index * 97) % total),
      endInstantNs: BigInt(((index * 97) % total) + 1),
      bpm: 60 + (index % 40),
      source: "watch",
      sourceOrder: index,
    }));
    const runs = createStagingRuns("generation", rows, 37);
    expect(runs.length).toBeGreaterThan(10);

    const merged = mergeStagingRuns("generation", runs, 64);
    expect(merged.acceptedCount).toBe(total);
    expect(merged.duplicateCount).toBe(0);
    for (let index = 1; index < merged.readings.length; index += 1) {
      const previous = merged.readings[index - 1]!;
      const current = merged.readings[index]!;
      const ordered =
        previous.instantNs < current.instantNs ||
        (previous.instantNs === current.instantNs && previous.sourceOrder <= current.sourceOrder);
      expect(ordered).toBe(true);
    }
    expect(merged.chunks.every((chunk) => chunk.rowCount <= 64)).toBe(true);
  });
});
