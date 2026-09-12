import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { googleFitFixture, nanos } from "../fixtures/google-fit-builder";
import {
  browserFixture,
  emptyBandFixture,
  importReady,
  importText,
  mixedQualityFixture,
} from "./support/fixtures";

async function expectNoSeriousAxeViolations(page: Page, state: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical",
  );
  expect(violations, `${state} axe violations`).toEqual([]);
}

function todayFixture(bpm = 76) {
  const now = new Date();
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return googleFitFixture([
    {
      startTimeNanos: nanos(todayStart + 3_600_000),
      endTimeNanos: nanos(todayStart + 3_600_000),
      bpm,
    },
  ]);
}

async function installWorkerScenario(
  page: Page,
  scenario: "indexing" | "loading" | "partial" | "cancelled" | "failed",
) {
  await page.addInitScript(
    ({ currentScenario }) => {
      const startMs = Date.UTC(2024, 0, 1, 0, 0, 0);
      const endMs = Date.UTC(2024, 0, 1, 0, 4, 0);
      const startNs = BigInt(startMs) * 1_000_000n;
      const endNs = BigInt(endMs) * 1_000_000n;
      const validationCounts = {
        accepted: 1,
        duplicate: 0,
        missing: 0,
        malformed: 0,
        outOfRange: 0,
      };
      const workerError = {
        code: "unexpected",
        message: "The local heart-rate index could not be completed.",
        recoverable: true,
        actions: ["reindex"],
      };

      const makeGeneration = (retention: "persistent" | "session") => ({
        generationId: "stub-generation",
        fileName: "stub-heart-rate.json",
        fileSize: 256,
        lastModified: startMs,
        formatVersion: 1,
        retention,
        status: "ready" as const,
        startedAt: startMs,
        completedAt: startMs + 1,
        acceptedCount: 1,
        duplicateCount: 0,
        validationCounts,
        minimumInstantNs: startNs,
        maximumInstantNs: endNs,
        chunkCount: 1,
        sourceDigest: "ab".repeat(32),
      });

      const makeDisplaySeries = () => ({
        timestamps: new Float64Array([startMs]),
        bpmValues: new Float64Array([72]),
        sourceIndexes: new Uint32Array([0]),
        gapBefore: new Uint8Array([0]),
        mode: "exact" as const,
      });

      const makeReadingPage = (rangeRevision: number) => ({
        rangeRevision,
        page: 1,
        pageSize: 50 as const,
        totalRows: 1,
        rows: [
          {
            sourceIndex: 0,
            instantMs: startMs,
            endInstantMs: startMs,
            bpm: 72,
            source: "stub-private-source",
          },
        ],
      });

      class ScenarioWorker extends EventTarget {
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: ErrorEvent) => void) | null = null;

        emit(data: unknown) {
          queueMicrotask(() =>
            this.onmessage?.(
              new MessageEvent("message", {
                data,
              }),
            ),
          );
        }

        postMessage(command: {
          type: string;
          requestId?: string;
          generationId?: string;
          datasetId?: string;
          retention?: "persistent" | "session";
          correlation?: {
            datasetId: string;
            generationId: string;
            viewId: string;
            requestId: string;
            rangeRevision: number;
          };
          range?: { startInstantNs: bigint; endInstantNs: bigint };
        }) {
          if (currentScenario === "indexing") {
            if (command.type === "index.start") {
              this.emit({
                type: "index.progress",
                requestId: command.requestId,
                datasetId: command.datasetId,
                generationId: command.generationId,
                phase: "reading",
                processedBytes: 1,
                totalBytes: 2,
                processedRecords: 1,
                totalRecords: 2,
              });
            } else if (command.type === "index.cancel") {
              this.emit({
                type: "index.cancelled",
                requestId: command.requestId,
                datasetId: command.datasetId,
                generationId: command.generationId,
                cleanupPending: false,
              });
            } else if (command.type === "index.open-active") {
              this.emit({ type: "index.unavailable", requestId: command.requestId });
            }
            return;
          }

          if (command.type === "index.open-active") {
            this.emit({ type: "index.unavailable", requestId: command.requestId });
            return;
          }

          if (command.type === "index.start") {
            this.emit({
              type: "index.ready",
              requestId: command.requestId,
              datasetId: command.datasetId,
              generationId: command.generationId,
              retention: command.retention ?? "persistent",
              generation: makeGeneration(command.retention ?? "persistent"),
              historyExtent: {
                startInstantNs: startNs,
                endInstantNs: endNs,
              },
            });
            return;
          }

          if (command.type === "range.load" && command.correlation && command.range) {
            this.emit({
              type: "range.started",
              correlation: command.correlation,
              requestedRange: command.range,
              selectedChunkCount: 1,
            });

            if (currentScenario === "loading") return;

            if (currentScenario === "partial") {
              this.emit({
                type: "range.snapshot",
                correlation: command.correlation,
                snapshot: {
                  ...command.correlation,
                  status: "partial",
                  requestedRange: command.range,
                  coveredIntervals: [command.range],
                  readingCount: 1,
                  displaySeries: makeDisplaySeries(),
                  readingPage: makeReadingPage(command.correlation.rangeRevision),
                  progress: { loadedChunkCount: 1, totalChunkCount: 2 },
                  summary: null,
                },
              });
              return;
            }

            if (currentScenario === "cancelled") {
              this.emit({
                type: "range.cancelled",
                correlation: command.correlation,
                reason: "user",
              });
              return;
            }

            if (currentScenario === "failed") {
              this.emit({
                type: "range.failed",
                correlation: command.correlation,
                error: workerError,
              });
            }
          }
        }

        terminate() {}
      }

      Object.defineProperty(window, "Worker", {
        configurable: true,
        value: ScenarioWorker,
      });
    },
    { currentScenario: scenario },
  );
}

test.describe("axe application states", () => {
  test("indexing remains accessible and keyboard-cancellable", async ({ page }) => {
    await installWorkerScenario(page, "indexing");
    await page.goto("/");
    await expectNoSeriousAxeViolations(page, "initial");
    await importText(page, browserFixture(), "accessibility-indexing.json");
    await expect(page.getByRole("button", { name: "Cancel import" })).toBeVisible();
    await expect(page.locator(".progress-block").getByText(/^Reading local index$/)).toBeVisible();
    await expectNoSeriousAxeViolations(page, "indexing");
    await page.getByRole("button", { name: "Cancel import" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel(/choose json file/i)).toBeVisible();
    await expectNoSeriousAxeViolations(page, "cancelled import");
  });

  for (const scenario of ["loading", "partial", "cancelled", "failed"] as const) {
    test(`${scenario} range state remains accessible`, async ({ page }) => {
      await installWorkerScenario(page, scenario);
      await page.goto("/");
      await importText(page, browserFixture(), `accessibility-${scenario}.json`);
      await expect(page.getByRole("heading", { name: "Heart rate graph" })).toBeVisible({
        timeout: 15_000,
      });

      if (scenario === "loading") {
        await expect(page.locator(".range-loading-status--loading")).toBeVisible();
      } else if (scenario === "partial") {
        await expect(page.locator(".range-loading-status--partial")).toBeVisible();
        await expect(page.getByText(/summary remains pending/i)).toBeVisible();
      } else if (scenario === "cancelled") {
        await expect(page.locator(".range-loading-status--cancelled")).toBeVisible();
      } else {
        await expect(page.locator(".range-loading-status--failed")).toBeVisible();
        await expect(page.getByRole("alert")).toContainText(/could not be completed/i);
      }

      await expectNoSeriousAxeViolations(page, `${scenario} range state`);
    });
  }

  test("complete state remains keyboard-accessible", async ({ page }) => {
    await page.goto("/");
    await importReady(page, browserFixture());
    await expectNoSeriousAxeViolations(page, "complete");

    const start = page.getByLabel("Start");
    const end = page.getByLabel("End");
    await start.focus();
    await start.fill("2024-01-01T00:02");
    await end.fill("2024-01-01T00:04");
    await page.keyboard.press("Enter");

    await expect(end).toBeFocused();
    await expect(page.getByRole("region", { name: "Visible range summary" })).toContainText("3");
    await expectNoSeriousAxeViolations(page, "complete after keyboard range apply");
  });

  test("empty state remains accessible", async ({ page }) => {
    await page.goto("/");
    await importReady(page, emptyBandFixture(), "empty-range.json");
    await page.getByLabel("Start").fill("2024-01-01T00:01");
    await page.getByLabel("End").fill("2024-01-01T00:01");
    await page.getByRole("button", { name: "Apply range" }).click();
    await expect(page.getByText("No readings in this range.").first()).toBeVisible();
    await expectNoSeriousAxeViolations(page, "empty range");
  });

  test("mixed-quality replacement and clear confirmation remain accessible", async ({ page }) => {
    await page.goto("/");
    await importReady(page, browserFixture(), "retained.json");
    await importReady(page, mixedQualityFixture(), "replacement.json");
    await expect(page.getByText(/records were excluded/i)).toBeVisible();
    await expectNoSeriousAxeViolations(page, "replacement complete");

    await page.getByRole("button", { name: "Clear retained data" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alertdialog")).toContainText(
      /clear retained local heart-rate data/i,
    );
    await expect(page.getByRole("button", { name: "Confirm clear" })).toBeFocused();
    await expectNoSeriousAxeViolations(page, "clear confirmation");

    await page.keyboard.press("Enter");
    await expect(page.getByLabel(/choose json file/i)).toBeVisible({ timeout: 15_000 });
    await expectNoSeriousAxeViolations(page, "cleared");
  });

  test("session-only retained data remains accessible", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "indexedDB", {
        configurable: true,
        value: undefined,
      });
    });
    await page.goto("/");
    await expect(page.getByText(/persistent storage is unavailable/i)).toBeVisible();
    await importText(page, todayFixture(), "session-only.json");
    await expect(
      page.getByText(/available for this session and disappears after refresh or tab closure/i),
    ).toBeVisible({ timeout: 15_000 });
    await expectNoSeriousAxeViolations(page, "session-only retained data");
  });

  test("fatal and replacement errors", async ({ page }) => {
    await page.goto("/");
    await importText(page, "{", "fatal.json");
    await expect(page.getByRole("alert")).toBeVisible();
    await expectNoSeriousAxeViolations(page, "fatal error");

    await page.reload();
    await importReady(page);
    await importText(page, "{", "replacement-error.json");
    await expect(page.getByRole("alert")).toContainText("current dataset was kept");
    await expectNoSeriousAxeViolations(page, "replacement error");
  });
});
