import { describe, expect, it } from "vitest";
import { nanosecondsToMilliseconds, normalizeRawRecord } from "../../src/domain/validation";

describe("nanosecond timestamps", () => {
  it("uses integer division without rounding tokens beyond Number.MAX_SAFE_INTEGER", () => {
    expect(nanosecondsToMilliseconds("9007199254740993123")).toBe(9_007_199_254_740);
  });

  it("preserves the absolute instant", () => {
    expect(nanosecondsToMilliseconds("1700000000123456789")).toBe(1_700_000_000_123);
  });

  it("rejects end instants before start instants", () => {
    expect(
      normalizeRawRecord({
        dataTypeName: "com.google.heart_rate.bpm",
        startTimeNanosToken: "2000000",
        endTimeNanosToken: "1000000",
        bpmCandidate: 70,
        originDataSourceId: "source",
      }),
    ).toEqual({ category: "malformed" });
  });
});
