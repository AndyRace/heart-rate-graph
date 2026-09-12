import { expect, test } from "@playwright/test";
import { googleFitFixture, nanos } from "../fixtures/google-fit-builder";
import { importReady } from "./support/fixtures";

test("never places source bytes, metadata, digest, chunks, summaries, or derived readings on the network", async ({
  page,
}) => {
  const now = new Date();
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const fileName = "private-health-sentinel-9f17.json";
  const replacementFileName = "replacement-health-sentinel-3a11.json";
  const source = "private-source-sentinel-6c42";
  const replacementSource = "replacement-source-sentinel-a8d0";
  const bpm = 287.123456;
  const replacementBpm = 143.987654;
  const timestamp = nanos(todayStart + 12_345);
  const replacementTimestamp = nanos(todayStart + 7_654_321);
  const payload = googleFitFixture([
    { startTimeNanos: timestamp, endTimeNanos: timestamp, bpm, source },
  ]);
  const replacementPayload = googleFitFixture([
    {
      startTimeNanos: replacementTimestamp,
      endTimeNanos: replacementTimestamp,
      bpm: replacementBpm,
      source: replacementSource,
    },
  ]);
  const sensitiveValues = new Set<string>([
    fileName,
    replacementFileName,
    source,
    replacementSource,
    timestamp,
    replacementTimestamp,
    payload,
    replacementPayload,
  ]);
  const violations: string[] = [];
  const outboundAfterSelection: string[] = [];
  let selected = false;

  await page.route("**/*", async (route) => {
    const request = route.request();
    const serialized = [
      request.url(),
      request.postData() ?? "",
      JSON.stringify(request.headers()),
    ].join("\n");
    if (
      [...sensitiveValues]
        .filter((value) => value.trim().length > 0)
        .some((value) => serialized.includes(value))
    ) {
      violations.push(`${request.method()} ${request.url()}`);
      await route.abort("blockedbyclient");
      return;
    }
    if (selected && request.method() !== "GET")
      outboundAfterSelection.push(`${request.method()} ${request.url()}`);
    await route.continue();
  });

  await page.goto("/");
  selected = true;
  await importReady(page, payload, fileName);

  const importMarkers = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("heart-rate-graph", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const readStore = <T>(storeName: string) =>
      new Promise<T[]>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error);
      });

    const [generations, manifests, chunks] = await Promise.all([
      readStore<{
        generationId: string;
        sourceDigest: string;
      }>("generations"),
      readStore<{
        checksum: string;
        chunks: Array<{ checksum: string }>;
      }>("manifests"),
      readStore<{
        generationId: string;
        checksum: string;
        payload: ArrayBuffer;
      }>("chunks"),
    ]);

    database.close();
    return {
      generations,
      manifests,
      chunks: chunks.map((chunk) => ({
        generationId: chunk.generationId,
        checksum: chunk.checksum,
        payloadPrefix: Array.from(new Uint8Array(chunk.payload).slice(0, 24)).join("-"),
      })),
      summaryText:
        document.querySelector<HTMLElement>('[aria-label="Visible range summary"]')?.innerText ??
        "",
      tableText:
        document.querySelector<HTMLElement>('[aria-label="Exact heart-rate readings"]')
          ?.innerText ?? "",
    };
  });

  for (const generation of importMarkers.generations) {
    sensitiveValues.add(generation.generationId);
    sensitiveValues.add(generation.sourceDigest);
  }
  for (const manifest of importMarkers.manifests) {
    sensitiveValues.add(manifest.checksum);
    for (const chunk of manifest.chunks) sensitiveValues.add(chunk.checksum);
  }
  for (const chunk of importMarkers.chunks) {
    sensitiveValues.add(chunk.generationId);
    sensitiveValues.add(chunk.checksum);
    sensitiveValues.add(chunk.payloadPrefix);
  }
  sensitiveValues.add(importMarkers.summaryText);
  sensitiveValues.add(importMarkers.tableText);

  await page.getByRole("img", { name: /heart rate from/i }).click();
  await expect(
    page.getByRole("region", { name: "Exact heart-rate readings" }).getByText("287.12 bpm"),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByText("Replace file")).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("region", { name: "Exact heart-rate readings" }).getByText("287.12 bpm"),
  ).toBeVisible();

  await importReady(page, replacementPayload, replacementFileName);
  await expect(
    page.getByRole("region", { name: "Exact heart-rate readings" }).getByText("143.99 bpm"),
  ).toBeVisible();

  const replacementMarkers = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("heart-rate-graph", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const readStore = <T>(storeName: string) =>
      new Promise<T[]>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error);
      });

    const [generations, manifests, chunks] = await Promise.all([
      readStore<{
        generationId: string;
        sourceDigest: string;
      }>("generations"),
      readStore<{
        checksum: string;
        chunks: Array<{ checksum: string }>;
      }>("manifests"),
      readStore<{
        generationId: string;
        checksum: string;
        payload: ArrayBuffer;
      }>("chunks"),
    ]);

    database.close();
    return {
      generations,
      manifests,
      chunks: chunks.map((chunk) => ({
        generationId: chunk.generationId,
        checksum: chunk.checksum,
        payloadPrefix: Array.from(new Uint8Array(chunk.payload).slice(0, 24)).join("-"),
      })),
      summaryText:
        document.querySelector<HTMLElement>('[aria-label="Visible range summary"]')?.innerText ??
        "",
      tableText:
        document.querySelector<HTMLElement>('[aria-label="Exact heart-rate readings"]')
          ?.innerText ?? "",
    };
  });

  for (const generation of replacementMarkers.generations) {
    sensitiveValues.add(generation.generationId);
    sensitiveValues.add(generation.sourceDigest);
  }
  for (const manifest of replacementMarkers.manifests) {
    sensitiveValues.add(manifest.checksum);
    for (const chunk of manifest.chunks) sensitiveValues.add(chunk.checksum);
  }
  for (const chunk of replacementMarkers.chunks) {
    sensitiveValues.add(chunk.generationId);
    sensitiveValues.add(chunk.checksum);
    sensitiveValues.add(chunk.payloadPrefix);
  }
  sensitiveValues.add(replacementMarkers.summaryText);
  sensitiveValues.add(replacementMarkers.tableText);

  await page.getByRole("button", { name: "Clear retained data" }).click();
  await page.getByRole("button", { name: "Confirm clear" }).click();
  await expect(page.getByLabel(/choose json file/i)).toBeVisible({ timeout: 15_000 });

  expect(violations).toEqual([]);
  expect(outboundAfterSelection).toEqual([]);
});
