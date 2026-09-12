import { describe, expect, it } from "vitest";
import { classifyRecords } from "../../src/domain/validation";

describe("record classification", () => {
  it("assigns every processed record to exactly one terminal category", () => {
    const base = {
      dataTypeName: "com.google.heart_rate.bpm",
      startTimeNanosToken: "1000000",
      endTimeNanosToken: "1000000",
      bpmCandidate: 70,
      originDataSourceId: "source",
    };
    const result = classifyRecords([
      base,
      base,
      { ...base, bpmCandidate: undefined },
      { ...base, startTimeNanosToken: "bad" },
      { ...base, bpmCandidate: 301 },
    ]);
    expect(result.counts).toEqual({
      accepted: 1,
      duplicate: 1,
      missing: 1,
      malformed: 1,
      outOfRange: 1,
    });
    expect(Object.values(result.counts).reduce((sum, count) => sum + count, 0)).toBe(5);
  });
});
