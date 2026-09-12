import { expect, type Page } from "@playwright/test";
import {
  generatedFixture,
  googleFitFixture,
  googleFitReading,
  nanos,
  type FixtureReading,
} from "../../fixtures/google-fit-builder";

export const FIXTURE_START_MS = Date.parse("2024-01-01T00:00:00Z");
export const PRIVATE_SENTINEL = "synthetic-private-source-never-transmit";

export function browserFixture(count = 9): string {
  return googleFitFixture(
    Array.from({ length: count }, (_, index) => ({
      startTimeNanos: nanos(FIXTURE_START_MS + index * 60_000),
      endTimeNanos: nanos(FIXTURE_START_MS + index * 60_000),
      bpm: 60 + index * 5,
      source: PRIVATE_SENTINEL,
    })),
  );
}

export function emptyBandFixture(): string {
  return googleFitFixture([
    {
      startTimeNanos: nanos(FIXTURE_START_MS),
      endTimeNanos: nanos(FIXTURE_START_MS),
      bpm: 60,
      source: PRIVATE_SENTINEL,
    },
    {
      startTimeNanos: nanos(FIXTURE_START_MS + 120_000),
      endTimeNanos: nanos(FIXTURE_START_MS + 120_000),
      bpm: 80,
      source: PRIVATE_SENTINEL,
    },
  ]);
}

export function mixedQualityFixture(): string {
  const valid: FixtureReading[] = [
    { startTimeNanos: nanos(FIXTURE_START_MS), endTimeNanos: nanos(FIXTURE_START_MS), bpm: 60 },
    {
      startTimeNanos: nanos(FIXTURE_START_MS + 60_000),
      endTimeNanos: nanos(FIXTURE_START_MS + 60_000),
      bpm: 80,
    },
    {
      startTimeNanos: nanos(FIXTURE_START_MS + 120_000),
      endTimeNanos: nanos(FIXTURE_START_MS + 120_000),
      bpm: 100,
    },
  ];
  return JSON.stringify({
    "Data Points": [
      ...valid.map(googleFitReading),
      googleFitReading(valid[0]),
      { dataTypeName: "com.google.heart_rate.bpm" },
      googleFitReading({ ...valid[1], dataTypeName: "synthetic.unsupported" }),
      googleFitReading({ ...valid[2], bpm: 301 }),
    ],
  });
}

export async function importText(page: Page, text: string, name = "synthetic-heart-rate.json") {
  await page.getByLabel(/choose json file|replace file/i).setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(text),
  });
}

export async function importReady(page: Page, text = browserFixture(), name?: string) {
  await importText(page, text, name);
  await expect(page.getByRole("heading", { name: "Heart rate graph" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("region", { name: "Exact heart-rate readings" })).toBeVisible();
  await expect(page.getByText("Summary is loading.")).toHaveCount(0);
}

export async function readingCount(page: Page): Promise<number> {
  const value = await page
    .getByRole("region", { name: "Visible range summary" })
    .locator("dd")
    .first()
    .textContent();
  return Number(value?.replace(/[^\d]/g, ""));
}

export const largeCancellationFixture = (): string => generatedFixture(75_000, FIXTURE_START_MS);
