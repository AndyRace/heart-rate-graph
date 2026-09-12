import { describe, expect, it, vi } from "vitest";
import { importFile } from "../../src/worker/import-worker";
import { generatedFixture, googleFitFixture } from "../fixtures/google-fit-builder";

const fileFrom = (text: string): File => {
  const bytes = new TextEncoder().encode(text);
  return {
    size: bytes.length,
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
  } as File;
};

describe("worker import", () => {
  it("commits valid records and reports immutable final counts", async () => {
    const progress = vi.fn();
    const result = await importFile(
      fileFrom(googleFitFixture([{ bpm: 70 }, { bpm: 70 }])),
      10,
      new AbortController().signal,
      progress,
    );
    expect(result.dataset.timestamps).toHaveLength(1);
    expect(result.counts).toMatchObject({ accepted: 1, duplicate: 1 });
    expect(Object.isFrozen(result.counts)).toBe(true);
  });

  it("fails malformed input and enforces the accepted-record cap", async () => {
    await expect(importFile(fileFrom("{"), 10, new AbortController().signal)).rejects.toThrow(
      "invalid-json",
    );
    await expect(
      importFile(
        fileFrom(googleFitFixture([{ bpm: 70 }, { bpm: 71 }])),
        1,
        new AbortController().signal,
      ),
    ).rejects.toThrow("record-limit");
  });

  it("honors cancellation before parsing", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      importFile(fileFrom(googleFitFixture([{ bpm: 70 }])), 10, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("yields so an in-progress single-chunk import can be cancelled", async () => {
    const controller = new AbortController();
    const pendingImport = importFile(fileFrom(generatedFixture(10_000)), 20_000, controller.signal);

    setTimeout(() => controller.abort(), 0);

    await expect(pendingImport).rejects.toMatchObject({ name: "AbortError" });
  });
});
