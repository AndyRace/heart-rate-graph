import { describe, expect, it } from "vitest";
import { buildCompactDataset } from "../../src/worker/compact-store";
import { queryRange } from "../../src/worker/queries";

describe("exact display series", () => {
  it("returns exact values, source indexes, and gaps only over 30 minutes", () => {
    const readings = [0, 1_800_000, 3_600_001].map((instantMs, sourceOrder) => ({
      instantMs,
      endInstantMs: instantMs,
      bpm: 60 + sourceOrder,
      sourceId: "source",
      sourceOrder,
    }));
    const { dataset } = buildCompactDataset(readings);
    const result = queryRange(dataset, 0, 3_600_001, 10);
    expect(result.series.mode).toBe("exact");
    expect([...result.series.sourceIndexes]).toEqual([0, 1, 2]);
    expect([...result.series.gapBefore]).toEqual([0, 0, 1]);
  });
});
