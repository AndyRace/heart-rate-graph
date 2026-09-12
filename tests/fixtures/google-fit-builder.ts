export interface FixtureReading {
  startTimeNanos?: string;
  endTimeNanos?: string;
  bpm?: number;
  source?: string;
  dataTypeName?: string;
}

export const nanos = (milliseconds: number | bigint): string =>
  `${BigInt(milliseconds) * 1_000_000n}`;

export function googleFitReading(reading: FixtureReading = {}): Record<string, unknown> {
  return {
    fitValue: [{ value: { fpVal: reading.bpm ?? 70 } }],
    originDataSourceId: reading.source ?? "synthetic:test-source",
    endTimeNanos: reading.endTimeNanos ?? nanos(1_700_000_000_000),
    dataTypeName: reading.dataTypeName ?? "com.google.heart_rate.bpm",
    startTimeNanos: reading.startTimeNanos ?? nanos(1_700_000_000_000),
  };
}

export const googleFitFixture = (readings: readonly FixtureReading[]): string =>
  JSON.stringify({ "Data Points": readings.map(googleFitReading) });

export function generatedFixture(count: number, startMs = 1_700_000_000_000): string {
  return googleFitFixture(
    Array.from({ length: count }, (_, index) => ({
      startTimeNanos: nanos(startMs + index * 60_000),
      endTimeNanos: nanos(startMs + index * 60_000),
      bpm: 60 + (index % 80),
      source: `synthetic:source-${index % 3}`,
    })),
  );
}

export function multiMonthFixture(
  start = new Date("2024-01-01T12:00:00.000Z"),
  monthCount = 6,
): string {
  const readings: FixtureReading[] = [];
  for (let monthOffset = 0; monthOffset < monthCount; monthOffset += 1) {
    const instant = new Date(start);
    instant.setUTCMonth(instant.getUTCMonth() + monthOffset);
    readings.push({
      startTimeNanos: nanos(instant.getTime()),
      endTimeNanos: nanos(instant.getTime()),
      bpm: 60 + monthOffset,
      source: `synthetic:month-${monthOffset % 2}`,
    });
  }
  return googleFitFixture(readings);
}

export const duplicateFixture = (): string => googleFitFixture([{ bpm: 70 }, { bpm: 70 }]);

export const outOfOrderFixture = (): string =>
  googleFitFixture([
    { startTimeNanos: nanos(2_000), endTimeNanos: nanos(2_000), bpm: 72 },
    { startTimeNanos: nanos(1_000), endTimeNanos: nanos(1_000), bpm: 68 },
  ]);

export const malformedRecordFixture = (): string =>
  JSON.stringify({ "Data Points": [{ dataTypeName: "com.google.heart_rate.bpm" }] });

export const gapFixture = (): string =>
  googleFitFixture([
    { startTimeNanos: nanos(0), endTimeNanos: nanos(0), bpm: 65 },
    { startTimeNanos: nanos(1_800_000), endTimeNanos: nanos(1_800_000), bpm: 66 },
    { startTimeNanos: nanos(3_600_001), endTimeNanos: nanos(3_600_001), bpm: 67 },
  ]);

export const timezoneFixture = (): string =>
  googleFitFixture([
    {
      startTimeNanos: nanos(Date.parse("2024-11-03T05:30:00Z")),
      endTimeNanos: nanos(Date.parse("2024-11-03T05:30:00Z")),
      bpm: 64,
    },
  ]);
