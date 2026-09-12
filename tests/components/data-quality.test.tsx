import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataQualityReport } from "../../src/features/import/DataQualityReport";
import { RangeSummary } from "../../src/features/accessible-data/RangeSummary";

describe("data quality and summary", () => {
  it("groups mutually exclusive excluded reasons", () => {
    render(
      <DataQualityReport
        counts={{ accepted: 4, duplicate: 1, missing: 2, malformed: 3, outOfRange: 4 }}
      />,
    );
    expect(screen.getByText(/10 records were excluded/i)).toBeInTheDocument();
    expect(screen.getByText("Duplicates")).toBeInTheDocument();
    expect(screen.getByText("Out of range")).toBeInTheDocument();
  });

  it("discloses aggregation and supports an empty exact range", () => {
    const { rerender } = render(
      <RangeSummary
        summary={{
          count: 1,
          minimumBpm: 70,
          maximumBpm: 70,
          meanBpm: 70,
          durationMs: 1,
          firstInstantMs: 0,
          lastInstantMs: 0,
        }}
        series={{
          timestamps: new Float64Array(),
          bpmValues: new Float64Array(),
          sourceIndexes: new Uint32Array(),
          gapBefore: new Uint8Array(),
          mode: "aggregated",
          bucketDurationMs: 10,
        }}
      />,
    );
    expect(screen.getByText(/display aggregated/i)).toBeInTheDocument();
    rerender(<RangeSummary summary={{ count: 0, durationMs: 100 }} />);
    expect(screen.getByText(/no readings in this range/i)).toBeInTheDocument();
  });
});
