import type { VisibleSummary } from "./readings";

export function calculateVisibleSummary(
  timestamps: ArrayLike<number>,
  bpmValues: ArrayLike<number>,
  startMs: number,
  endMs: number,
  startIndex: number,
  endIndexExclusive: number,
): VisibleSummary {
  const count = Math.max(0, endIndexExclusive - startIndex);
  if (count === 0) return { count: 0, durationMs: endMs - startMs };
  let minimumBpm = Number.POSITIVE_INFINITY;
  let maximumBpm = Number.NEGATIVE_INFINITY;
  let total = 0;
  for (let index = startIndex; index < endIndexExclusive; index += 1) {
    const bpm = bpmValues[index]!;
    minimumBpm = Math.min(minimumBpm, bpm);
    maximumBpm = Math.max(maximumBpm, bpm);
    total += bpm;
  }
  return {
    count,
    minimumBpm,
    maximumBpm,
    meanBpm: total / count,
    durationMs: endMs - startMs,
    firstInstantMs: timestamps[startIndex],
    lastInstantMs: timestamps[endIndexExclusive - 1],
  };
}
