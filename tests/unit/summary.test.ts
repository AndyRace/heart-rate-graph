import { describe, expect, it } from "vitest";
import { calculateVisibleSummary } from "../../src/domain/summary";

describe("visible summary", () => {
  it("calculates exact count, extrema, mean, instants, and selected duration", () => {
    expect(calculateVisibleSummary([10, 20, 30], [60, 90, 75], 10, 40, 0, 3)).toEqual({
      count: 3,
      minimumBpm: 60,
      maximumBpm: 90,
      meanBpm: 75,
      durationMs: 30,
      firstInstantMs: 10,
      lastInstantMs: 30,
    });
  });

  it("omits statistics and instants for an empty range", () => {
    expect(calculateVisibleSummary([], [], 10, 20, 0, 0)).toEqual({ count: 0, durationMs: 10 });
  });
});
