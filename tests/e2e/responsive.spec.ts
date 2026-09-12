import { expect, test, type Page } from "@playwright/test";
import { googleFitFixture, nanos } from "../fixtures/google-fit-builder";
import { emptyBandFixture, importReady, importText } from "./support/fixtures";

const VIEWPORT_WIDTHS = [320, 768, 1280, 1920] as const;

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

async function expectNoPageOverflowOrControlOverlap(page: Page) {
  const layout = await page.evaluate(() => {
    const main = document.getElementById("main-content") ?? document.documentElement;
    const viewport = main.getBoundingClientRect();
    const primaryBoxes = [
      ...document.querySelectorAll<HTMLElement>(
        [
          "button",
          "input:not([type='file'])",
          "select",
          ".file-button",
          ".range-loading-status",
          ".progress-block",
          ".notice",
          ".retention-note",
          ".retention-subtle",
        ].join(", "),
      ),
    ]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
    const overlaps = primaryBoxes.some((first, index) =>
      primaryBoxes
        .slice(index + 1)
        .some(
          (second) =>
            Math.min(first.right, second.right) - Math.max(first.left, second.left) > 2 &&
            Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 2,
        ),
    );
    return {
      pageOverflows: main.scrollWidth > document.documentElement.clientWidth + 1,
      controlsOutsideViewport: primaryBoxes.some(
        ({ left, right }) => left < viewport.left - 1 || right > viewport.right + 1,
      ),
      overlaps,
    };
  });
  expect(layout).toEqual({
    pageOverflows: false,
    controlsOutsideViewport: false,
    overlaps: false,
  });
}

async function expectNoControlOrStatusOverlap(page: Page) {
  const overlaps = await page.evaluate(() => {
    const primaryBoxes = [
      ...document.querySelectorAll<HTMLElement>(
        [
          "button",
          "input:not([type='file'])",
          "select",
          ".file-button",
          ".range-loading-status",
          ".progress-block",
          ".notice",
          ".retention-note",
          ".retention-subtle",
        ].join(", "),
      ),
    ]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });

    return primaryBoxes.some((first, index) =>
      primaryBoxes
        .slice(index + 1)
        .some(
          (second) =>
            Math.min(first.right, second.right) - Math.max(first.left, second.left) > 2 &&
            Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 2,
        ),
    );
  });

  expect(overlaps).toBe(false);
}

test.describe("responsive and zoomed layouts", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Layout matrix runs in Chromium");

  for (const width of VIEWPORT_WIDTHS) {
    test(`${width}px keeps every primary journey control available`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await importReady(page);

      await expectNoPageOverflowOrControlOverlap(page);
      await expect(page.getByRole("img", { name: /heart rate from/i })).toBeVisible();
      await expect(page.getByLabel("Start")).toBeVisible();
      await expect(page.getByRole("region", { name: "Visible range summary" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Exact heart-rate readings" })).toBeVisible();

      if (width === 320) {
        const chart = page.getByRole("img", { name: /heart rate from/i });
        expect((await chart.boundingBox())?.height).toBeGreaterThanOrEqual(300);
      }
    });

    test(`${width}px remains usable at 200% zoom`, async ({ page }) => {
      await page.setViewportSize({ width: width * 2, height: 1800 });
      await page.goto("/");
      await importReady(page);
      await page.evaluate(() => {
        document.documentElement.style.zoom = "200%";
      });

      await expectNoPageOverflowOrControlOverlap(page);
      await expect(page.getByRole("button", { name: "Apply range" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Reset" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Visible range summary" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Exact heart-rate readings" })).toBeVisible();
    });
  }

  test("320px equivalent at 200% zoom keeps session retention and clear confirmation separated", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "indexedDB", {
        configurable: true,
        value: undefined,
      });
    });
    await page.setViewportSize({ width: 640, height: 2000 });
    await page.goto("/");
    await expect(page.getByText(/persistent storage is unavailable/i)).toBeVisible();
    await importText(page, todayFixture(), "session-only.json");
    await expect(page.getByRole("heading", { name: "Heart rate graph" })).toBeVisible({
      timeout: 15_000,
    });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "200%";
    });

    await expect(page.getByText(/persistent storage is unavailable/i)).toBeVisible();
    await expectNoControlOrStatusOverlap(page);

    await page.getByRole("button", { name: "Clear retained data" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Confirm clear" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Keep retained data" })).toBeVisible();
  });

  test("320px equivalent at 200% zoom keeps empty and replacement-error status clear of controls", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 2200 });
    await page.goto("/");
    await importReady(page, emptyBandFixture(), "empty-band.json");
    await page.evaluate(() => {
      document.documentElement.style.zoom = "200%";
    });

    await page.getByLabel("Start").fill("2024-01-01T00:01");
    await page.getByLabel("End").fill("2024-01-01T00:01");
    await page.getByRole("button", { name: "Apply range" }).click();
    await expect(page.getByText("No readings in this range.").first()).toBeVisible();
    await expectNoPageOverflowOrControlOverlap(page);

    await page.getByLabel(/replace file/i).setInputFiles({
      name: "broken-replacement.json",
      mimeType: "application/json",
      buffer: Buffer.from("{"),
    });
    await expect(page.getByRole("alert")).toContainText(/current dataset was kept/i);
    await expectNoPageOverflowOrControlOverlap(page);
  });
});
