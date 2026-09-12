import { expect, test, type Locator } from "@playwright/test";
import { importReady, readingCount } from "./support/fixtures";

async function dragBand(chart: Locator, fromRatio: number, toRatio: number, pointerType = "mouse") {
  const box = await chart.boundingBox();
  expect(box).not.toBeNull();
  const y = box!.y + box!.height / 2;
  const fromX = box!.x + box!.width * fromRatio;
  const toX = box!.x + box!.width * toRatio;
  if (pointerType === "touch") {
    await chart.evaluate((element) => {
      Object.defineProperty(element, "setPointerCapture", { value: () => undefined });
    });
    await chart.dispatchEvent("pointerdown", {
      clientX: fromX,
      clientY: y,
      pointerId: 1,
      pointerType,
    });
    await chart.dispatchEvent("pointermove", {
      clientX: toX,
      clientY: y,
      pointerId: 1,
      pointerType,
    });
    await chart.dispatchEvent("pointerup", { clientX: toX, clientY: y, pointerId: 1, pointerType });
  } else {
    await chart.page().mouse.move(fromX, y);
    await chart.page().mouse.down();
    await chart.page().mouse.move(toX, y, { steps: 5 });
    await chart.page().mouse.up();
  }
}

test("desktop pointer drill-down supports nesting and reset", async ({ page, isMobile }) => {
  test.skip(isMobile, "Desktop pointer journey");
  await page.goto("/");
  await importReady(page);
  await page.getByRole("button", { name: "Reset" }).click();
  await expect.poll(() => readingCount(page)).toBe(9);
  const chart = page.getByRole("img", { name: /heart rate from/i });

  await dragBand(chart, 0.2, 0.8);
  await expect.poll(() => readingCount(page)).toBeLessThan(9);
  const firstCount = await readingCount(page);

  await dragBand(chart, 0.25, 0.75);
  await expect.poll(() => readingCount(page)).toBeLessThan(firstCount);
  await page.getByRole("button", { name: "Reset" }).click();
  await expect.poll(() => readingCount(page)).toBe(9);
});

test("mobile touch drill-down commits the same canonical range", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Mobile touch journey");
  await page.goto("/");
  await importReady(page);
  await page.getByRole("button", { name: "Reset" }).click();
  await expect.poll(() => readingCount(page)).toBe(9);
  const chart = page.getByRole("img", { name: /heart rate from/i });
  await dragBand(chart, 0.25, 0.75, "touch");
  await expect.poll(() => readingCount(page)).toBeLessThan(9);
  await expect(page.getByLabel("Start")).not.toHaveValue("2024-01-01T00:00");
});

test("keyboard-only fields synchronize summary, table, focus, and reset", async ({ page }) => {
  await page.goto("/");
  await importReady(page);
  const start = page.getByLabel("Start");
  const end = page.getByLabel("End");

  await start.focus();
  await start.fill("2024-01-01T00:02");
  await end.fill("2024-01-01T00:04");
  await page.keyboard.press("Enter");

  await expect(end).toBeFocused();
  await expect.poll(() => readingCount(page)).toBe(3);
  await expect(
    page.getByRole("region", { name: "Exact heart-rate readings" }).getByRole("row"),
  ).toHaveCount(4);

  await page.getByRole("button", { name: "Reset" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Reset" })).toBeFocused();
  await expect.poll(() => readingCount(page)).toBe(9);
});
