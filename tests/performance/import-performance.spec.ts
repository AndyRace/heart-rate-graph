import { expect, test, type Page } from "@playwright/test";
import { generateMillionRecordFixture, MILLION_RECORD_PATH } from "./generate-million-records";

export const PERFORMANCE_BUDGETS = {
  desktop: {
    importMs: 10_000,
    peakMemoryBytes: 768 * 1024 * 1024,
    cancellationMs: 1_000,
    rangeLatencyMs: 500,
  },
  mobile: {
    importMs: 10_000,
    peakMemoryBytes: 512 * 1024 * 1024,
    cancellationMs: 1_500,
    rangeLatencyMs: 500,
  },
} as const;

type MemoryPerformance = Performance & {
  readonly memory?: { readonly usedJSHeapSize: number };
};

async function usedHeap(page: Page): Promise<number> {
  return page.evaluate(() => (performance as MemoryPerformance).memory?.usedJSHeapSize ?? 0);
}

test.describe("one-million-record budgets", () => {
  test.skip(
    process.env.HEART_RATE_RUN_MILLION_PERF !== "1",
    "Set HEART_RATE_RUN_MILLION_PERF=1 to run the resource-intensive gate",
  );
  test.beforeAll(async () => {
    await generateMillionRecordFixture();
  });

  for (const profile of ["desktop", "mobile"] as const) {
    test(`${profile}: import, peak memory, cancellation, and range latency`, async ({
      page,
    }, testInfo) => {
      const expectedProject = profile === "desktop" ? "chromium" : "mobile-chrome";
      test.skip(testInfo.project.name !== expectedProject, `${profile} budget project only`);
      test.setTimeout(180_000);
      const budget = PERFORMANCE_BUDGETS[profile];
      await page.goto("/");

      const importStarted = performance.now();
      await page.getByLabel("Choose JSON file").setInputFiles(MILLION_RECORD_PATH);
      let peakMemoryBytes = await usedHeap(page);
      while ((await page.getByRole("heading", { name: "Heart rate graph" }).count()) === 0) {
        peakMemoryBytes = Math.max(peakMemoryBytes, await usedHeap(page));
        if (performance.now() - importStarted > 120_000) break;
        await page.waitForTimeout(50);
      }
      await expect(page.getByRole("heading", { name: "Heart rate graph" })).toBeVisible({
        timeout: Math.max(1, 120_000 - (performance.now() - importStarted)),
      });
      const importMs = performance.now() - importStarted;
      peakMemoryBytes = Math.max(peakMemoryBytes, await usedHeap(page));
      expect(importMs, `${profile} import budget`).toBeLessThanOrEqual(budget.importMs);
      expect(peakMemoryBytes, `${profile} heap measurement is available`).toBeGreaterThan(0);
      expect(peakMemoryBytes, `${profile} peak-memory budget`).toBeLessThanOrEqual(
        budget.peakMemoryBytes,
      );

      await page.getByLabel("Start").fill("2024-01-01T00:10");
      await page.getByLabel("End").fill("2024-01-01T00:20");
      const rangeStarted = performance.now();
      await page.getByRole("button", { name: "Apply range" }).click();
      await expect(page.getByRole("region", { name: "Visible range summary" })).toContainText(
        "601",
        { timeout: budget.rangeLatencyMs },
      );
      const rangeLatencyMs = performance.now() - rangeStarted;
      expect(rangeLatencyMs, `${profile} range-latency budget`).toBeLessThanOrEqual(
        budget.rangeLatencyMs,
      );

      await page.getByLabel("Replace file").setInputFiles(MILLION_RECORD_PATH);
      await expect(page.getByRole("button", { name: "Cancel import" })).toBeVisible();
      const cancellationStarted = performance.now();
      await page.getByRole("button", { name: "Cancel import" }).click();
      await expect(page.getByText("Replacement cancelled")).toHaveText("Replacement cancelled", {
        timeout: budget.cancellationMs,
      });
      const cancellationMs = performance.now() - cancellationStarted;
      expect(cancellationMs, `${profile} cancellation budget`).toBeLessThanOrEqual(
        budget.cancellationMs,
      );
      await expect(page.getByRole("heading", { name: "Heart rate graph" })).toBeVisible();
      console.log(
        `PERFORMANCE_METRICS ${JSON.stringify({ profile, importMs: Math.round(importMs), peakMemoryBytes, rangeLatencyMs: Math.round(rangeLatencyMs), cancellationMs: Math.round(cancellationMs) })}`,
      );
    });
  }
});
