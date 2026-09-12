import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import { parseGoogleFitSource, parseGoogleFitStream } from "../../src/worker/parser-adapter";
import { googleFitFixture } from "../fixtures/google-fit-builder";

const chunkedStream = (text: string, chunkSize = 1): ReadableStream<Uint8Array> => {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize)
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
      controller.close();
    },
  });
};

describe("Google Fit streaming parser", () => {
  it("extracts the supported paths and preserves large nanosecond token text across chunks", async () => {
    const start = "9007199254740993123";
    const records = await parseGoogleFitStream(
      chunkedStream(
        googleFitFixture([
          { startTimeNanos: start, endTimeNanos: start, bpm: 72.5, source: "watch" },
        ]),
      ),
    );
    expect(records).toEqual([
      {
        dataTypeName: "com.google.heart_rate.bpm",
        startTimeNanosToken: start,
        endTimeNanosToken: start,
        bpmCandidate: 72.5,
        originDataSourceId: "watch",
      },
    ]);
  });

  it("rejects malformed JSON and a missing Data Points array", async () => {
    await expect(parseGoogleFitStream(chunkedStream('{"Data Points":['))).rejects.toThrow(
      "invalid-json",
    );
    await expect(parseGoogleFitStream(chunkedStream('{"other":[]}'))).rejects.toThrow(
      "unsupported-schema",
    );
  });

  it("hashes source bytes in the parsing pass and streams records without accumulating them", async () => {
    const text = googleFitFixture([
      { startTimeNanos: "1000001", endTimeNanos: "1000009", bpm: 72, source: "watch" },
      { startTimeNanos: "2000001", endTimeNanos: "2000009", bpm: 73, source: "watch" },
    ]);
    const accepted: string[] = [];
    const result = await parseGoogleFitSource(
      { size: text.length, stream: () => chunkedStream(text, 7) } as File,
      (record) => accepted.push(String(record.startTimeNanosToken)),
      new AbortController().signal,
    );

    expect(accepted).toEqual(["1000001", "2000001"]);
    expect(result).toEqual({
      bytesRead: new TextEncoder().encode(text).byteLength,
      sourceDigest: "c065c56fe91c3e8c4684025e700741264d5eb0a6af621cec740b3303e720937d",
    });
  });

  it("cooperatively cancels a streaming sink", async () => {
    const controller = new AbortController();
    const text = googleFitFixture(Array.from({ length: 20_000 }, () => ({ bpm: 72 })));
    const pending = parseGoogleFitSource(
      { size: text.length, stream: () => chunkedStream(text, text.length) } as File,
      () => undefined,
      controller.signal,
    );
    queueMicrotask(() => controller.abort());
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("checks for cancellation between parser slices rather than only at the boundaries", async () => {
    const total = 5_000;
    const text = googleFitFixture(Array.from({ length: total }, () => ({ bpm: 72 })));
    const controller = new AbortController();
    let received = 0;
    const pending = parseGoogleFitSource(
      { size: text.length, stream: () => chunkedStream(text, 64) } as File,
      () => {
        received += 1;
        if (received === 25) controller.abort();
      },
      controller.signal,
    );

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(received).toBeGreaterThan(0);
    expect(received).toBeLessThan(total);
  });

  it("hashes the exact source bytes rather than parsed record values", async () => {
    const text = googleFitFixture([
      { startTimeNanos: "1", endTimeNanos: "1", bpm: 72, source: "watch" },
    ]);
    const expectedDigest = bytesToHex(sha256(new TextEncoder().encode(text)));
    const result = await parseGoogleFitSource(
      { size: text.length, stream: () => chunkedStream(text, 3) } as File,
      () => undefined,
      new AbortController().signal,
    );
    expect(result.sourceDigest).toBe(expectedDigest);

    const mutatedText = text.replace('"watch"', '"watcj"');
    const mutatedResult = await parseGoogleFitSource(
      { size: mutatedText.length, stream: () => chunkedStream(mutatedText, 3) } as File,
      () => undefined,
      new AbortController().signal,
    );
    expect(mutatedResult.sourceDigest).not.toBe(expectedDigest);
  });
});
