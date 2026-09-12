import { describe, expect, it } from "vitest";
import { parseLocalDateTime } from "../../src/domain/local-date-time";

describe("local date and time", () => {
  it("accepts valid wall time inside the dataset", () => {
    const instant = new Date(2024, 0, 15, 12, 30).getTime();
    expect(
      parseLocalDateTime("2024-01-15T12:30", { startMs: instant - 1, endMs: instant + 1 }),
    ).toMatchObject({
      status: "valid",
      instantMs: instant,
    });
  });

  it("rejects invalid and out-of-dataset values", () => {
    expect(parseLocalDateTime("not-a-date", { startMs: 0, endMs: 1 })).toEqual({
      status: "invalid",
    });
    expect(parseLocalDateTime("2024-01-15T12:30", { startMs: 0, endMs: 1 })).toEqual({
      status: "out-of-range",
    });
  });
});
