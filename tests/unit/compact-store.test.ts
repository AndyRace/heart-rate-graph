import { describe, expect, it } from "vitest";
import { buildCompactDataset } from "../../src/worker/compact-store";

describe("compact dataset", () => {
  it("stores bpm in Float64Array and sorts by instant then source order", () => {
    const result = buildCompactDataset([
      { instantMs: 20, endInstantMs: 20, bpm: 80, sourceId: "b", sourceOrder: 0 },
      { instantMs: 10, endInstantMs: 10, bpm: 70, sourceId: "a", sourceOrder: 1 },
      { instantMs: 10, endInstantMs: 10, bpm: 71, sourceId: "a", sourceOrder: 0 },
    ]);
    expect(result.dataset.bpmValues).toBeInstanceOf(Float64Array);
    expect([...result.dataset.bpmValues]).toEqual([71, 70, 80]);
  });

  it("retains the first identical start/end/bpm/source tuple", () => {
    const result = buildCompactDataset([
      { instantMs: 10, endInstantMs: 11, bpm: 70, sourceId: "a", sourceOrder: 3 },
      { instantMs: 10, endInstantMs: 11, bpm: 70, sourceId: "a", sourceOrder: 4 },
      { instantMs: 10, endInstantMs: 11, bpm: 70, sourceId: "b", sourceOrder: 5 },
    ]);
    expect(result.duplicateCount).toBe(1);
    expect([...result.dataset.sourceOrders]).toEqual([3, 5]);
  });
});
