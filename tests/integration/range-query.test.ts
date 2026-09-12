import { describe, expect, it } from "vitest";
import { buildCompactDataset } from "../../src/worker/compact-store";
import { queryRange } from "../../src/worker/queries";

describe("range queries", () => {
  const { dataset } = buildCompactDataset(
    Array.from({ length: 1_000 }, (_, sourceOrder) => ({
      instantMs: sourceOrder,
      endInstantMs: sourceOrder,
      bpm: sourceOrder % 100,
      sourceId: "source",
      sourceOrder,
    })),
  );

  it("uses inclusive binary-search boundaries", () => {
    const result = queryRange(dataset, 100, 200, 1_000);
    expect(result.summary.count).toBe(101);
    expect(result.summary.firstInstantMs).toBe(100);
    expect(result.summary.lastInstantMs).toBe(200);
  });

  it("returns no more than four source values per CSS pixel", () => {
    const result = queryRange(dataset, 0, 999, 25);
    expect(result.series.mode).toBe("aggregated");
    expect(result.series.timestamps.length).toBeLessThanOrEqual(100);
    expect(result.series.timestamps.buffer).toBeInstanceOf(ArrayBuffer);
  });
});
