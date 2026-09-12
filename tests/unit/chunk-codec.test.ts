import { describe, expect, it } from "vitest";
import {
  checksumChunkPayload,
  decodeReadingChunk,
  encodeReadingChunk,
} from "../../src/worker/chunk-codec";
import type { ExactReading } from "../../src/domain/readings";

const rows: readonly ExactReading[] = [
  { instantNs: -(1n << 63n), bpm: 1, sourceId: 0, sourceOrder: 0 },
  { instantNs: 1_700_000_000_123_456_789n, bpm: 72.125, sourceId: 1, sourceOrder: 7 },
  { instantNs: (1n << 63n) - 1n, bpm: 300, sourceId: 1, sourceOrder: 0xffff_ffff },
];

describe("reading chunk codec", () => {
  it("round-trips exact columns and writes the versioned little-endian aligned header", () => {
    const encoded = encodeReadingChunk(rows);
    const view = new DataView(encoded.payload);

    expect(new TextDecoder().decode(new Uint8Array(encoded.payload, 0, 8))).toBe("HRGCHNK1");
    expect(view.getUint16(8, true)).toBe(1);
    expect(view.getUint16(10, true) % 8).toBe(0);
    expect(view.getUint32(12, true)).toBe(rows.length);
    expect([16, 20, 24, 28].map((offset) => view.getUint32(offset, true))).toEqual([
      32, 56, 80, 92,
    ]);

    const decoded = decodeReadingChunk(encoded.payload, {
      checksum: encoded.checksum,
      rowCount: rows.length,
      sourceTableLength: 2,
    });
    expect([...decoded.instantNs]).toEqual(rows.map((row) => row.instantNs));
    expect([...decoded.bpm]).toEqual(rows.map((row) => row.bpm));
    expect([...decoded.sourceIds]).toEqual(rows.map((row) => row.sourceId));
    expect([...decoded.sourceOrders]).toEqual(rows.map((row) => row.sourceOrder));
  });

  it.each([
    { name: "zero rows", value: [] },
    { name: "too many rows", value: Array.from({ length: 16_385 }, () => rows[0]!) },
    { name: "non-finite BPM", value: [{ ...rows[0]!, bpm: Number.NaN }] },
    { name: "BPM below one", value: [{ ...rows[0]!, bpm: 0 }] },
    { name: "BPM above 300", value: [{ ...rows[0]!, bpm: 301 }] },
    { name: "negative source ID", value: [{ ...rows[0]!, sourceId: -1 }] },
    { name: "source order above Uint32", value: [{ ...rows[0]!, sourceOrder: 0x1_0000_0000 }] },
    {
      name: "timestamp below signed 64-bit",
      value: [{ ...rows[0]!, instantNs: -(1n << 63n) - 1n }],
    },
    {
      name: "non-monotonic instant/source order",
      value: [
        { instantNs: 10n, bpm: 70, sourceId: 0, sourceOrder: 2 },
        { instantNs: 10n, bpm: 71, sourceId: 0, sourceOrder: 1 },
      ],
    },
  ])("rejects $name", ({ value }) => {
    expect(() => encodeReadingChunk(value)).toThrow();
  });

  it("rejects checksum, magic, version, offset, payload length, source bounds, and row disagreement", () => {
    const encoded = encodeReadingChunk(rows.slice(0, 2));
    const corrupt = encoded.payload.slice(0);
    new Uint8Array(corrupt)[corrupt.byteLength - 1]! ^= 0xff;
    expect(() =>
      decodeReadingChunk(corrupt, {
        checksum: encoded.checksum,
        rowCount: 2,
        sourceTableLength: 2,
      }),
    ).toThrow(/checksum/i);

    const cases: Array<{ payload: ArrayBuffer; message: RegExp }> = [];
    const badMagic = encoded.payload.slice(0);
    new Uint8Array(badMagic)[0] = 0;
    cases.push({ payload: badMagic, message: /magic/i });
    const badVersion = encoded.payload.slice(0);
    new DataView(badVersion).setUint16(8, 2, true);
    cases.push({ payload: badVersion, message: /version/i });
    const badOffset = encoded.payload.slice(0);
    new DataView(badOffset).setUint32(20, 33, true);
    cases.push({ payload: badOffset, message: /offset|align/i });
    cases.push({ payload: encoded.payload.slice(0, -1), message: /length/i });

    for (const testCase of cases) {
      expect(() =>
        decodeReadingChunk(testCase.payload, {
          checksum: checksumChunkPayload(testCase.payload),
          rowCount: 2,
          sourceTableLength: 2,
        }),
      ).toThrow(testCase.message);
    }
    expect(() =>
      decodeReadingChunk(encoded.payload, {
        checksum: encoded.checksum,
        rowCount: 1,
        sourceTableLength: 2,
      }),
    ).toThrow(/row count/i);

    const outOfBounds = encodeReadingChunk([{ ...rows[0]!, sourceId: 2 }]);
    expect(() =>
      decodeReadingChunk(outOfBounds.payload, {
        checksum: outOfBounds.checksum,
        rowCount: 1,
        sourceTableLength: 2,
      }),
    ).toThrow(/source/i);
  });
});
