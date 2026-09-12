import { expect, test } from "@playwright/test";
import { browserFixture, importReady, PRIVATE_SENTINEL, readingCount } from "./support/fixtures";

test("imports locally and exposes the full exact dataset visually and non-visually", async ({
  page,
  isMobile,
}) => {
  const leakedRequests: string[] = [];
  page.on("request", (request) => {
    const serialized = `${request.url()}\n${request.postData() ?? ""}\n${JSON.stringify(request.headers())}`;
    if (serialized.includes(PRIVATE_SENTINEL) || serialized.includes("synthetic-heart-rate.json"))
      leakedRequests.push(serialized);
  });

  await page.goto("/");
  await expect(page.getByText(/not uploaded or retained/i)).toBeVisible();
  await importReady(page, browserFixture());
  await page.getByRole("button", { name: "Reset" }).click();
  await expect.poll(() => readingCount(page)).toBe(9);

  const chart = page.getByRole("img", { name: /heart rate from/i });
  await expect(chart).toBeVisible();
  await expect(page.getByText("Exact readings", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Visible range summary" })).toContainText("9");

  const table = page.getByRole("region", { name: "Exact heart-rate readings" });
  await expect(table.getByRole("row")).toHaveCount(10);
  await expect(table).toContainText("60 bpm");
  await expect(table).toContainText("100 bpm");
  await expect(table).toContainText(PRIVATE_SENTINEL);

  const box = await chart.boundingBox();
  expect(box).not.toBeNull();
  if (isMobile) await chart.tap({ position: { x: box!.width / 2, y: box!.height / 2 } });
  else await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  const pointDetails = page.locator(".point-details");
  await expect(pointDetails.getByText("80 bpm", { exact: true })).toBeVisible();
  await expect(pointDetails.getByText(PRIVATE_SENTINEL)).toBeVisible();
  expect(leakedRequests).toEqual([]);
});
