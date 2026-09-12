import { expect, test } from "@playwright/test";
import { googleFitFixture, nanos } from "../fixtures/google-fit-builder";
import { importText } from "./support/fixtures";

// Browser timezone is forced to UTC (playwright.config.ts), so UTC-day math matches the app's local-day boundaries.
function todayStartMs(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function dayStartMs(daysBeforeToday: number): number {
  return todayStartMs() - daysBeforeToday * 86_400_000;
}

function toDateTimeLocalInput(instantMs: number): string {
  return new Date(instantMs).toISOString().slice(0, 16);
}

test("indexes once and opens one coherent snapshot for the current local day", async ({ page }) => {
  await page.goto("/");
  const today = new Date();
  const todayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const yesterday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1);
  await importText(
    page,
    googleFitFixture([
      { startTimeNanos: nanos(yesterday), endTimeNanos: nanos(yesterday), bpm: 61 },
      {
        startTimeNanos: nanos(todayStart + 60_000),
        endTimeNanos: (BigInt(todayStart + 60_000) * 1_000_000n + 123n).toString(),
        bpm: 72,
      },
    ]),
  );

  await expect(page.getByText(/publishing|cleaning|heart rate graph/i).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Heart rate graph" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("region", { name: "Visible range summary" })).toContainText("1");
  await expect(page.getByRole("region", { name: "Exact heart-rate readings" })).toContainText(
    "72 bpm",
  );
  await expect(page.getByRole("region", { name: "Exact heart-rate readings" })).not.toContainText(
    "61 bpm",
  );
});

test("keeps today selected when its complete snapshot is empty", async ({ page }) => {
  await page.goto("/");
  await importText(
    page,
    googleFitFixture([
      {
        startTimeNanos: nanos(Date.UTC(2020, 0, 1)),
        endTimeNanos: nanos(Date.UTC(2020, 0, 1)),
        bpm: 70,
      },
    ]),
  );
  await expect(page.getByRole("heading", { name: "Heart rate graph" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("No readings in this range.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset" })).toBeEnabled();
});

test("indexes a deterministic multi-month/today source, agrees across graph/summary/table/detail, reloads the retained generation without file reselection, and transmits no health data", async ({
  page,
}) => {
  const today = new Date();
  const todayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  const historicalBpms = [91, 92, 93, 94];
  const historical = historicalBpms.map((bpm, index) => {
    const monthsBack = index + 1;
    const instant = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - monthsBack, 1, 12);
    return {
      startTimeNanos: nanos(instant),
      endTimeNanos: nanos(instant),
      bpm,
      source: `synthetic:history-${monthsBack}`,
    };
  });

  const todayBpms = [55, 66, 77];
  const todayReadings = todayBpms.map((bpm, index) => {
    const instant = todayStart + index * 8 * 60 * 60 * 1000 + 30 * 60 * 1000;
    return {
      startTimeNanos: nanos(instant),
      endTimeNanos: nanos(instant),
      bpm,
      source: `synthetic:today-${index}`,
    };
  });

  const payload = googleFitFixture([...historical, ...todayReadings]);
  const sensitiveValues = [
    ...historical.map((reading) => reading.source),
    ...todayReadings.map((reading) => reading.source),
    ...todayReadings.map((reading) => reading.startTimeNanos),
  ];
  const violations: string[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const serialized = [
      request.url(),
      request.postData() ?? "",
      JSON.stringify(request.headers()),
    ].join("\n");
    if (
      sensitiveValues.some((value) => serialized.includes(value)) ||
      serialized.includes(payload)
    ) {
      violations.push(`${request.method()} ${request.url()}`);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await importText(page, payload);
  await expect(page.getByRole("heading", { name: "Heart rate graph" })).toBeVisible({
    timeout: 15_000,
  });

  const summary = page.getByRole("region", { name: "Visible range summary" });
  const readingsRegion = page.getByRole("region", { name: "Exact heart-rate readings" });
  await expect(summary).toContainText(String(todayBpms.length));
  for (const bpm of todayBpms) await expect(readingsRegion).toContainText(`${bpm} bpm`);
  for (const bpm of historicalBpms) await expect(readingsRegion).not.toContainText(`${bpm} bpm`);
  await expect(readingsRegion.locator("tbody tr")).toHaveCount(todayBpms.length);

  await page.getByRole("img", { name: /heart rate from/i }).click();
  const detailBpmText = await page.locator(".point-details strong").textContent();
  const detailBpm = Number(detailBpmText?.replace(/[^\d.]/g, ""));
  expect(todayBpms).toContain(detailBpm);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Heart rate graph" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Replace file")).toBeVisible();
  await expect(page.getByText("Choose JSON file")).not.toBeVisible();
  await expect(summary).toContainText(String(todayBpms.length));
  for (const bpm of todayBpms) await expect(readingsRegion).toContainText(`${bpm} bpm`);
  for (const bpm of historicalBpms) await expect(readingsRegion).not.toContainText(`${bpm} bpm`);

  expect(violations).toEqual([]);
});

test("loads a previously uncached historical day on demand and converges graph/summary/table", async ({
  page,
}) => {
  const today = todayStartMs();
  const yesterday = dayStartMs(1);
  await page.goto("/");
  await importText(
    page,
    googleFitFixture([
      { startTimeNanos: nanos(today + 3_600_000), endTimeNanos: nanos(today + 3_600_000), bpm: 82 },
      {
        startTimeNanos: nanos(yesterday),
        endTimeNanos: nanos(yesterday),
        bpm: 58,
      },
    ]),
  );
  await expect(page.getByRole("heading", { name: "Heart rate graph" })).toBeVisible();
  const summary = page.getByRole("region", { name: "Visible range summary" });
  const readingsRegion = page.getByRole("region", { name: "Exact heart-rate readings" });
  await expect(page.locator(".range-loading-status--complete")).toBeVisible({ timeout: 15_000 });
  await expect(summary).toContainText("1");
  await expect(readingsRegion).toContainText("82 bpm");

  await page.getByRole("button", { name: "Previous day" }).click();

  await expect(page.locator(".range-loading-status--complete")).toBeVisible({ timeout: 15_000 });
  await expect(summary).toContainText("1");
  await expect(readingsRegion).toContainText("58 bpm");
  await expect(readingsRegion).not.toContainText("82 bpm");
});

test("expands a committed range to include previously uncached history without losing already-loaded readings", async ({
  page,
}) => {
  const today = todayStartMs();
  const twoDaysAgo = dayStartMs(2);
  await page.goto("/");
  await importText(
    page,
    googleFitFixture([
      { startTimeNanos: nanos(today + 3_600_000), endTimeNanos: nanos(today + 3_600_000), bpm: 45 },
      {
        startTimeNanos: nanos(twoDaysAgo + 3_600_000),
        endTimeNanos: nanos(twoDaysAgo + 3_600_000),
        bpm: 65,
      },
    ]),
  );
  const summary = page.getByRole("region", { name: "Visible range summary" });
  const readingsRegion = page.getByRole("region", { name: "Exact heart-rate readings" });
  await expect(page.locator(".range-loading-status--complete")).toBeVisible({ timeout: 15_000 });
  await expect(summary).toContainText("1");
  await expect(readingsRegion).toContainText("45 bpm");

  // A single small fixture yields one storage chunk, so the transient "partial" frame between
  // chunks is not reliably observable here; this asserts the coverage-merge outcome instead.
  await page
    .getByLabel("Start", { exact: true })
    .fill(toDateTimeLocalInput(twoDaysAgo + 3_600_000));
  await page.getByLabel("End", { exact: true }).fill(toDateTimeLocalInput(today + 3_600_000));
  await page.getByRole("button", { name: "Apply range" }).click();

  await expect(page.locator(".range-loading-status--complete")).toBeVisible({ timeout: 15_000 });
  await expect(summary).toContainText("2");
  await expect(readingsRegion).toContainText("45 bpm");
  await expect(readingsRegion).toContainText("65 bpm");
});

test("zooms out broadly across the full history and converges on the complete dataset", async ({
  page,
}) => {
  const today = todayStartMs();
  const historicalBpms = [111, 122, 133];
  const historical = historicalBpms.map((bpm, index) => {
    const instant = dayStartMs((index + 1) * 45) + 3_600_000;
    return { startTimeNanos: nanos(instant), endTimeNanos: nanos(instant), bpm };
  });
  await page.goto("/");
  await importText(
    page,
    googleFitFixture([
      ...historical,
      { startTimeNanos: nanos(today + 3_600_000), endTimeNanos: nanos(today + 3_600_000), bpm: 44 },
    ]),
  );
  const summary = page.getByRole("region", { name: "Visible range summary" });
  const readingsRegion = page.getByRole("region", { name: "Exact heart-rate readings" });
  await expect(page.locator(".range-loading-status--complete")).toBeVisible({ timeout: 15_000 });

  const zoomOut = page.getByRole("button", { name: "Zoom out", exact: true });
  for (let click = 0; click < 12; click += 1) await zoomOut.click();

  await expect(page.locator(".range-loading-status--complete")).toBeVisible({ timeout: 15_000 });
  await expect(summary).toContainText("4");
  await expect(readingsRegion).toContainText("44 bpm");
  for (const bpm of historicalBpms) await expect(readingsRegion).toContainText(`${bpm} bpm`);
});

test("shows an empty state for a committed range with no readings between existing data", async ({
  page,
}) => {
  const fiveDaysAgo = dayStartMs(5);
  const oneDayAgo = dayStartMs(1);
  const emptyDay = dayStartMs(3);
  await page.goto("/");
  await importText(
    page,
    googleFitFixture([
      {
        startTimeNanos: nanos(fiveDaysAgo + 3_600_000),
        endTimeNanos: nanos(fiveDaysAgo + 3_600_000),
        bpm: 71,
      },
      {
        startTimeNanos: nanos(oneDayAgo + 3_600_000),
        endTimeNanos: nanos(oneDayAgo + 3_600_000),
        bpm: 91,
      },
    ]),
  );
  await expect(page.getByRole("heading", { name: "Heart rate graph" })).toBeVisible();

  await page.getByLabel("Start", { exact: true }).fill(toDateTimeLocalInput(emptyDay));
  await page.getByLabel("End", { exact: true }).fill(toDateTimeLocalInput(emptyDay + 82_800_000));
  await page.getByRole("button", { name: "Apply range" }).click();

  await expect(page.locator(".range-loading-status--empty")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("No readings in this range.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset" })).toBeEnabled();
});

test("recovers from a corrupted local chunk by re-importing after a range load failure", async ({
  page,
}) => {
  const today = todayStartMs();
  const yesterday = dayStartMs(1);
  await page.goto("/");
  const payload = googleFitFixture([
    { startTimeNanos: nanos(today + 3_600_000), endTimeNanos: nanos(today + 3_600_000), bpm: 82 },
    {
      startTimeNanos: nanos(yesterday),
      endTimeNanos: nanos(yesterday),
      bpm: 58,
    },
  ]);
  await importText(page, payload);
  await expect(page.getByRole("heading", { name: "Heart rate graph" })).toBeVisible();
  await expect(page.locator(".range-loading-status--complete")).toBeVisible({ timeout: 15_000 });

  // Corrupt the sole persisted chunk's bytes directly so decoding fails its checksum check,
  // producing a genuine range.failed instead of a mocked/timing-based failure.
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("heart-rate-graph", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("chunks", "readwrite");
      const store = transaction.objectStore("chunks");
      const allRequest = store.getAll();
      allRequest.onsuccess = () => {
        for (const chunk of allRequest.result as { payload: ArrayBuffer }[]) {
          new Uint8Array(chunk.payload)[chunk.payload.byteLength - 1] ^= 0xff;
          store.put(chunk);
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });

  await page.reload();
  await expect(page.locator(".range-loading-status--failed")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("alert")).toContainText("could not be completed");

  await importText(page, payload);
  await expect(page.getByText("Replace file")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".range-loading-status--complete")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(page.locator(".range-loading-status--complete")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("region", { name: "Exact heart-rate readings" })).toContainText(
    "58 bpm",
  );
});

test("commits 20 ranges in rapid succession and only the latest revision's result is ever displayed", async ({
  page,
}) => {
  const readings = Array.from({ length: 20 }, (_, index) => {
    const daysBack = index + 1;
    const instant = dayStartMs(daysBack);
    return {
      startTimeNanos: nanos(instant),
      endTimeNanos: nanos(instant),
      bpm: 100 + daysBack,
    };
  });
  await page.goto("/");
  await importText(page, googleFitFixture(readings));
  await expect(page.getByRole("heading", { name: "Heart rate graph" })).toBeVisible();

  const startField = page.getByLabel("Start", { exact: true });
  const endField = page.getByLabel("End", { exact: true });
  const applyButton = page.getByRole("button", { name: "Apply range" });

  for (let daysBack = 1; daysBack <= 20; daysBack += 1) {
    const instant = dayStartMs(daysBack);
    await startField.fill(toDateTimeLocalInput(instant));
    await endField.fill(toDateTimeLocalInput(instant));
    await applyButton.click();
  }

  await expect(page.locator(".range-loading-status--complete")).toBeVisible({ timeout: 20_000 });

  const summary = page.getByRole("region", { name: "Visible range summary" });
  const readingsRegion = page.getByRole("region", { name: "Exact heart-rate readings" });
  await expect(summary).toContainText("1");
  await expect(readingsRegion).toContainText("120 bpm");
  await expect(readingsRegion.locator("tbody tr")).toHaveCount(1);
  for (let daysBack = 1; daysBack <= 19; daysBack += 1) {
    await expect(readingsRegion).not.toContainText(`${100 + daysBack} bpm`);
  }
});

test("quietly prepares adjacent days, reopens retained data, and switches atomically to a replacement source", async ({
  page,
}) => {
  const today = todayStartMs();
  const yesterday = dayStartMs(1);
  const tomorrow = dayStartMs(-1);
  await page.goto("/");
  await importText(
    page,
    googleFitFixture([
      { startTimeNanos: nanos(today + 3_600_000), endTimeNanos: nanos(today + 3_600_000), bpm: 82 },
      {
        startTimeNanos: nanos(yesterday + 3_600_000),
        endTimeNanos: nanos(yesterday + 3_600_000),
        bpm: 58,
      },
      {
        startTimeNanos: nanos(tomorrow + 3_600_000),
        endTimeNanos: nanos(tomorrow + 3_600_000),
        bpm: 91,
      },
    ]),
    "retained.json",
  );

  await expect(page.getByRole("heading", { name: "Heart rate graph" })).toBeVisible();
  const summary = page.getByRole("region", { name: "Visible range summary" });
  const readingsRegion = page.getByRole("region", { name: "Exact heart-rate readings" });
  await expect(page.locator(".range-loading-status--complete")).toBeVisible({ timeout: 15_000 });
  await expect(summary).toContainText("1");
  await expect(readingsRegion).toContainText("82 bpm");
  await expect(page.getByTestId("read-ahead-status")).toContainText(/quietly|ready/i);
  await expect(readingsRegion).not.toContainText("58 bpm");

  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(page.locator(".range-loading-status--complete")).toBeVisible({ timeout: 15_000 });
  await expect(readingsRegion).toContainText("58 bpm");

  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page.locator(".range-loading-status--complete")).toBeVisible({ timeout: 15_000 });
  await expect(readingsRegion).toContainText("82 bpm");

  await page.reload();
  await expect(page.getByText("Replace file")).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText(/retained on this device|retained locally on this device/i),
  ).toBeVisible();
  await expect(readingsRegion).toContainText("82 bpm");

  await importText(
    page,
    googleFitFixture([
      { startTimeNanos: nanos(today + 7_200_000), endTimeNanos: nanos(today + 7_200_000), bpm: 99 },
      {
        startTimeNanos: nanos(tomorrow + 3_600_000),
        endTimeNanos: nanos(tomorrow + 3_600_000),
        bpm: 101,
      },
    ]),
    "replacement.json",
  );

  await expect(page.locator(".range-loading-status--complete")).toBeVisible({ timeout: 15_000 });
  await expect(summary).toContainText("1");
  await expect(readingsRegion).toContainText("99 bpm");
  await expect(readingsRegion).not.toContainText("82 bpm");
  await expect(readingsRegion).not.toContainText("58 bpm");

  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page.locator(".range-loading-status--complete")).toBeVisible({ timeout: 15_000 });
  await expect(readingsRegion).toContainText("101 bpm");
  await expect(readingsRegion).not.toContainText("91 bpm");
});

test("keeps the prior dataset after a failed replacement and clears retained data back to no-source state", async ({
  page,
}) => {
  const today = todayStartMs();
  await page.goto("/");
  await importText(
    page,
    googleFitFixture([
      { startTimeNanos: nanos(today + 3_600_000), endTimeNanos: nanos(today + 3_600_000), bpm: 82 },
    ]),
    "first.json",
  );
  await expect(page.getByRole("heading", { name: "Heart rate graph" })).toBeVisible();

  await page.getByLabel(/replace file/i).setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("{"),
  });

  await expect(page.getByRole("alert")).toContainText(/current dataset was kept/i);
  await expect(page.getByRole("region", { name: "Exact heart-rate readings" })).toContainText(
    "82 bpm",
  );

  await page.getByRole("button", { name: "Clear retained data" }).click();
  await expect(page.getByRole("alertdialog")).toContainText(
    /clear retained local heart-rate data/i,
  );
  await page.getByRole("button", { name: "Confirm clear" }).click();

  await expect(page.getByLabel(/choose json file/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Replace file")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Heart rate graph" })).toHaveCount(0);
});

test("drops session-only data on reload when persistent storage is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: undefined,
    });
  });
  const today = todayStartMs();
  await page.goto("/");
  await expect(page.getByText(/persistent storage is unavailable/i)).toBeVisible();

  await importText(
    page,
    googleFitFixture([
      { startTimeNanos: nanos(today + 3_600_000), endTimeNanos: nanos(today + 3_600_000), bpm: 76 },
    ]),
    "session-only.json",
  );

  await expect(page.getByRole("heading", { name: "Heart rate graph" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByText(/available for this session and disappears after refresh or tab closure/i),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByLabel(/choose json file/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Replace file")).toHaveCount(0);
});
