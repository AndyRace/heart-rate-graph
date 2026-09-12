import { expect, test } from "@playwright/test";
import {
  importReady,
  importText,
  largeCancellationFixture,
  mixedQualityFixture,
  readingCount,
} from "./support/fixtures";

test("reports mixed-quality data and retains the active range after replacement failures", async ({
  page,
}) => {
  await page.goto("/");
  await importReady(page, mixedQualityFixture(), "mixed-synthetic.json");
  await page.getByRole("button", { name: "Reset" }).click();
  await expect.poll(() => readingCount(page)).toBe(3);

  const quality = page
    .getByRole("heading", { name: "Data quality" })
    .locator("xpath=ancestor::section");
  await expect(quality).toContainText("3 accepted");
  await expect(quality).toContainText("4 records were excluded");
  for (const reason of ["Duplicates", "Missing fields", "Malformed", "Out of range"])
    await expect(quality).toContainText(reason);
  await expect(quality.locator("dd")).toHaveText(["1", "1", "1", "1"]);

  const summary = page.getByRole("region", { name: "Visible range summary" });
  await expect(summary).toContainText("60 bpm");
  await expect(summary).toContainText("100 bpm");
  await expect(summary).toContainText("80 bpm");
  expect(await readingCount(page)).toBe(3);

  const originalStart = await page.getByLabel("Start").inputValue();
  const originalEnd = await page.getByLabel("End").inputValue();
  await importText(page, "{", "malformed-replacement.json");
  await expect(page.getByRole("alert")).toContainText("current dataset was kept");
  await expect(page.getByLabel("Start")).toHaveValue(originalStart);
  await expect(page.getByLabel("End")).toHaveValue(originalEnd);
  expect(await readingCount(page)).toBe(3);

  await importText(page, largeCancellationFixture(), "cancelled-replacement.json");
  await page.getByRole("button", { name: "Cancel import" }).click({ force: true });
  await expect(page.getByText("Replacement cancelled")).toHaveText("Replacement cancelled");
  await expect(page.getByLabel("Start")).toHaveValue(originalStart);
  await expect(page.getByLabel("End")).toHaveValue(originalEnd);
  expect(await readingCount(page)).toBe(3);
});
