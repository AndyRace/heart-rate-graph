import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";

export const MILLION_RECORD_COUNT = 1_000_000;
export const MILLION_RECORD_PATH = path.resolve(
  "tests/performance/generated/million-heart-rate.json",
);
const START_MS = Date.parse("2024-01-01T00:00:00Z");

function recordAt(index: number): string {
  const nanos = `${BigInt(START_MS + index * 1_000) * 1_000_000n}`;
  return JSON.stringify({
    fitValue: [{ value: { fpVal: 50 + (index % 151) } }],
    endTimeNanos: nanos,
    dataTypeName: "com.google.heart_rate.bpm",
    startTimeNanos: nanos,
  });
}

async function write(stream: ReturnType<typeof createWriteStream>, chunk: string) {
  if (!stream.write(chunk)) await once(stream, "drain");
}

export async function generateMillionRecordFixture(
  outputPath = MILLION_RECORD_PATH,
): Promise<string> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await rm(temporaryPath, { force: true });
  const stream = createWriteStream(temporaryPath, { encoding: "utf8" });
  try {
    await write(stream, '{"Data Points":[');
    for (let start = 0; start < MILLION_RECORD_COUNT; start += 2_000) {
      const end = Math.min(start + 2_000, MILLION_RECORD_COUNT);
      const records = Array.from({ length: end - start }, (_, offset) => recordAt(start + offset));
      await write(stream, `${start === 0 ? "" : ","}${records.join(",")}`);
    }
    await write(stream, "]}");
    stream.end();
    await once(stream, "close");
    await rm(outputPath, { force: true });
    await rename(temporaryPath, outputPath);
    return outputPath;
  } catch (error) {
    stream.destroy();
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

// ---- On-demand-readings performance fixture (spread across many local calendar days ending today) ----

/** Total accepted readings across the whole fixture (spec.md SC-001..SC-003 use this scale). */
export const ON_DEMAND_RECORD_COUNT = 1_000_000;
/** Distinct local calendar days the readings are spread across, ending with today (day 0). */
export const ON_DEMAND_DAY_COUNT = 100;
export const ON_DEMAND_RECORDS_PER_DAY = ON_DEMAND_RECORD_COUNT / ON_DEMAND_DAY_COUNT;
export const ON_DEMAND_FIXTURE_PATH = path.resolve(
  "tests/performance/generated/on-demand-million-heart-rate.json",
);
const ONE_DAY_MS = 86_400_000;

export interface OnDemandFixtureManifest {
  readonly path: string;
  readonly todayStartMs: number;
  /** Local midnight (UTC, matching the forced browser timezone) indexed by days-before-today; index 0 is today. */
  readonly dayStartsMsByDaysBeforeToday: readonly number[];
  readonly recordsPerDay: number;
  readonly totalRecords: number;
}

function onDemandRecordAt(dayStartMs: number, indexWithinDay: number, spacingMs: number): string {
  const instantMs = dayStartMs + indexWithinDay * spacingMs;
  const nanosValue = `${BigInt(instantMs) * 1_000_000n}`;
  return JSON.stringify({
    fitValue: [{ value: { fpVal: 50 + (indexWithinDay % 151) } }],
    endTimeNanos: nanosValue,
    dataTypeName: "com.google.heart_rate.bpm",
    startTimeNanos: nanosValue,
  });
}

/**
 * Generates exactly `dayCount` * (totalRecords / dayCount) accepted readings, evenly spread across
 * `dayCount` distinct local calendar days ending with today, so cold/warm/uncached/cache-reuse
 * performance scenarios can each target genuinely distinct, deterministic days.
 */
export async function generateOnDemandMillionFixture(
  outputPath = ON_DEMAND_FIXTURE_PATH,
  dayCount = ON_DEMAND_DAY_COUNT,
  totalRecords = ON_DEMAND_RECORD_COUNT,
): Promise<OnDemandFixtureManifest> {
  const recordsPerDay = Math.floor(totalRecords / dayCount);
  const spacingMs = Math.floor(ONE_DAY_MS / recordsPerDay);
  const now = new Date();
  const todayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayStartsMsByDaysBeforeToday = Array.from(
    { length: dayCount },
    (_, daysBeforeToday) => todayStartMs - daysBeforeToday * ONE_DAY_MS,
  );

  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await rm(temporaryPath, { force: true });
  const stream = createWriteStream(temporaryPath, { encoding: "utf8" });
  try {
    await write(stream, '{"Data Points":[');
    let wroteAny = false;
    for (let daysBeforeToday = dayCount - 1; daysBeforeToday >= 0; daysBeforeToday -= 1) {
      const dayStartMs = dayStartsMsByDaysBeforeToday[daysBeforeToday]!;
      for (let start = 0; start < recordsPerDay; start += 2_000) {
        const end = Math.min(start + 2_000, recordsPerDay);
        const records = Array.from({ length: end - start }, (_, offset) =>
          onDemandRecordAt(dayStartMs, start + offset, spacingMs),
        );
        await write(stream, `${wroteAny ? "," : ""}${records.join(",")}`);
        wroteAny = true;
      }
    }
    await write(stream, "]}");
    stream.end();
    await once(stream, "close");
    await rm(outputPath, { force: true });
    await rename(temporaryPath, outputPath);
  } catch (error) {
    stream.destroy();
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return {
    path: outputPath,
    todayStartMs,
    dayStartsMsByDaysBeforeToday,
    recordsPerDay,
    totalRecords: recordsPerDay * dayCount,
  };
}
