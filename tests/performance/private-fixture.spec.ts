import { expect, test } from "@playwright/test";

const fixturePath = process.env.HEART_RATE_PRIVATE_FIXTURE;

type MemoryPerformance = Performance & {
  readonly memory?: { readonly usedJSHeapSize: number };
};

test("validates the private Google Fit export without exposing source values", async ({
  page,
}, testInfo) => {
  test.skip(!fixturePath, "Set HEART_RATE_PRIVATE_FIXTURE to the ignored export path");
  test.skip(testInfo.project.name !== "chromium", "Private fixture gate runs in Chromium");
  test.setTimeout(180_000);

  await page.goto("/");
  const startedAt = performance.now();
  await page.getByLabel("Choose JSON file").setInputFiles(fixturePath!);

  let processedRecords = 0;
  let peakMemoryBytes = 0;
  let outcome = "pending";
  while (performance.now() - startedAt < 150_000) {
    const observation = await page.evaluate(() => ({
      ready: Boolean(document.querySelector(".workspace")),
      alert: document.querySelector('[role="alert"]')?.textContent ?? "",
      progress: document.querySelector(".progress-block span")?.textContent ?? "",
      heap: (performance as MemoryPerformance).memory?.usedJSHeapSize ?? 0,
    }));
    peakMemoryBytes = Math.max(peakMemoryBytes, observation.heap);
    const progressCount = observation.progress.match(/[\d,]+/)?.[0];
    if (progressCount)
      processedRecords = Math.max(processedRecords, Number(progressCount.replaceAll(",", "")));
    if (observation.ready) {
      outcome = "ready";
      break;
    }
    if (observation.alert) {
      outcome = observation.alert.includes("1,000,000") ? "record-limit" : "failed";
      break;
    }
    await page.waitForTimeout(100);
  }

  const metrics = {
    outcome,
    processedRecords,
    durationMs: Math.round(performance.now() - startedAt),
    peakMemoryBytes,
  };
  await testInfo.attach("private-fixture-metrics.json", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
  console.log(`PRIVATE_FIXTURE_METRICS ${JSON.stringify(metrics)}`);

  expect(["ready", "record-limit"]).toContain(outcome);
  if (outcome === "record-limit") expect(processedRecords).toBeGreaterThanOrEqual(900_000);
});
