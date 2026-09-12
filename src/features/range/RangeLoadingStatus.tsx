import type { RangeProgress, RangeStatus, TimeBand } from "../../domain/readings";
import { formatInstant } from "../../shared/format";

interface RangeLoadingStatusProps {
  readonly status: RangeStatus;
  readonly requestedRange: TimeBand;
  readonly progress?: RangeProgress;
  readonly readingCount?: number;
  readonly error?: string;
  readonly stale?: boolean;
}

export function RangeLoadingStatus({
  status,
  requestedRange,
  progress,
  readingCount,
  error,
  stale = false,
}: RangeLoadingStatusProps) {
  const progressText = meaningfulProgress(progress);
  const message = statusMessage(status, progressText, readingCount, error);
  return (
    <div
      className={`range-loading-status range-loading-status--${status}`}
      data-range-revision={requestedRange.revision}
      data-range-status={status}
      role={status === "failed" ? "alert" : "status"}
      aria-live={status === "failed" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <strong>{message}</strong>
      <span>
        {formatInstant(requestedRange.startMs)} to {formatInstant(requestedRange.endMs)}
      </span>
      {stale && <span>Previously completed results are shown while this range loads.</span>}
    </div>
  );
}

function meaningfulProgress(progress?: RangeProgress): string {
  if (!progress || progress.totalChunkCount <= 0) return "";
  const percentage = Math.floor((progress.loadedChunkCount / progress.totalChunkCount) * 10) * 10;
  return ` ${Math.min(100, percentage)}%`;
}

function statusMessage(
  status: RangeStatus,
  progress: string,
  readingCount?: number,
  error?: string,
): string {
  switch (status) {
    case "queued":
      return "Range queued.";
    case "loading":
      return `Loading range${progress}.`;
    case "partial":
      return `Readings are partially available${progress}; summary remains pending.`;
    case "complete":
      return `Range complete${readingCount === undefined ? "" : ` with ${readingCount} readings`}.`;
    case "empty":
      return "Selected range has no readings.";
    case "cancelled":
      return "Range loading cancelled.";
    case "failed":
      return error ?? "Could not load this range.";
  }
}
