import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  INDEX_FORMAT_VERSION,
  MAX_CHUNK_ROWS,
  type DecodedChunkColumns,
  type ExactReading,
} from "../domain/readings";

const MAGIC = new TextEncoder().encode("HRGCHNK1");
const HEADER_LENGTH = 32;
const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;
const UINT32_MAX = 0xffff_ffff;

export interface EncodedReadingChunk {
  readonly payload: ArrayBuffer;
  readonly checksum: string;
}

export interface DecodeReadingChunkOptions {
  readonly checksum: string;
  readonly rowCount: number;
  readonly sourceTableLength: number;
}

export function checksumChunkPayload(payload: ArrayBuffer): string {
  return bytesToHex(sha256(new Uint8Array(payload)));
}

export function encodeReadingChunk(rows: readonly ExactReading[]): EncodedReadingChunk {
  assertRowCount(rows.length);
  validateRows(rows);

  const timestampOffset = HEADER_LENGTH;
  const bpmOffset = timestampOffset + rows.length * BigInt64Array.BYTES_PER_ELEMENT;
  const sourceIdOffset = bpmOffset + rows.length * Float64Array.BYTES_PER_ELEMENT;
  const sourceOrderOffset = sourceIdOffset + rows.length * Uint32Array.BYTES_PER_ELEMENT;
  const endTimestampOffset = sourceOrderOffset + rows.length * Uint32Array.BYTES_PER_ELEMENT;
  const payload = new ArrayBuffer(
    endTimestampOffset + rows.length * BigInt64Array.BYTES_PER_ELEMENT,
  );
  const bytes = new Uint8Array(payload);
  bytes.set(MAGIC);
  const view = new DataView(payload);
  view.setUint16(8, INDEX_FORMAT_VERSION, true);
  view.setUint16(10, HEADER_LENGTH, true);
  view.setUint32(12, rows.length, true);
  view.setUint32(16, timestampOffset, true);
  view.setUint32(20, bpmOffset, true);
  view.setUint32(24, sourceIdOffset, true);
  view.setUint32(28, sourceOrderOffset, true);

  rows.forEach((row, index) => {
    view.setBigInt64(timestampOffset + index * 8, row.instantNs, true);
    view.setFloat64(bpmOffset + index * 8, row.bpm, true);
    view.setUint32(sourceIdOffset + index * 4, row.sourceId, true);
    view.setUint32(sourceOrderOffset + index * 4, row.sourceOrder, true);
    view.setBigInt64(endTimestampOffset + index * 8, row.endInstantNs ?? row.instantNs, true);
  });

  return { payload, checksum: checksumChunkPayload(payload) };
}

export function decodeReadingChunk(
  payload: ArrayBuffer,
  options: DecodeReadingChunkOptions,
): DecodedChunkColumns {
  if (checksumChunkPayload(payload) !== options.checksum.toLowerCase()) {
    throw new Error("Chunk checksum mismatch");
  }
  if (payload.byteLength < HEADER_LENGTH) throw new Error("Chunk payload length is invalid");
  const bytes = new Uint8Array(payload);
  if (!MAGIC.every((value, index) => bytes[index] === value))
    throw new Error("Chunk magic is invalid");

  const view = new DataView(payload);
  if (view.getUint16(8, true) !== INDEX_FORMAT_VERSION) {
    throw new Error("Chunk format version is unsupported");
  }
  const headerLength = view.getUint16(10, true);
  const rowCount = view.getUint32(12, true);
  assertRowCount(rowCount);
  if (rowCount !== options.rowCount)
    throw new Error("Chunk row count disagrees with its descriptor");
  if (!Number.isSafeInteger(options.sourceTableLength) || options.sourceTableLength < 0) {
    throw new RangeError("Source table length must be a non-negative integer");
  }

  const timestampOffset = view.getUint32(16, true);
  const bpmOffset = view.getUint32(20, true);
  const sourceIdOffset = view.getUint32(24, true);
  const sourceOrderOffset = view.getUint32(28, true);
  const expectedOffsets = [
    HEADER_LENGTH,
    HEADER_LENGTH + rowCount * 8,
    HEADER_LENGTH + rowCount * 16,
    HEADER_LENGTH + rowCount * 20,
  ];
  const offsets = [timestampOffset, bpmOffset, sourceIdOffset, sourceOrderOffset];
  if (
    headerLength !== HEADER_LENGTH ||
    offsets.some((offset, index) => offset !== expectedOffsets[index])
  ) {
    throw new Error("Chunk column offsets or alignment are invalid");
  }
  const expectedLength = HEADER_LENGTH + rowCount * 32;
  if (payload.byteLength !== expectedLength) throw new Error("Chunk payload length is invalid");

  const instantNs = new BigInt64Array(rowCount);
  const bpm = new Float64Array(rowCount);
  const sourceIds = new Uint32Array(rowCount);
  const sourceOrders = new Uint32Array(rowCount);
  const endInstantNs = new BigInt64Array(rowCount);
  const endTimestampOffset = sourceOrderOffset + rowCount * 4;
  for (let index = 0; index < rowCount; index += 1) {
    instantNs[index] = view.getBigInt64(timestampOffset + index * 8, true);
    bpm[index] = view.getFloat64(bpmOffset + index * 8, true);
    sourceIds[index] = view.getUint32(sourceIdOffset + index * 4, true);
    sourceOrders[index] = view.getUint32(sourceOrderOffset + index * 4, true);
    endInstantNs[index] = view.getBigInt64(endTimestampOffset + index * 8, true);
    if (!isValidBpm(bpm[index]!)) throw new Error("Chunk BPM value is invalid");
    if (endInstantNs[index]! < instantNs[index]!) throw new Error("Chunk end timestamp is invalid");
    if (sourceIds[index]! >= options.sourceTableLength)
      throw new Error("Chunk source ID is out of bounds");
    if (
      index > 0 &&
      (instantNs[index - 1]! > instantNs[index]! ||
        (instantNs[index - 1] === instantNs[index] &&
          sourceOrders[index - 1]! > sourceOrders[index]!))
    ) {
      throw new Error("Chunk rows are not monotonically ordered");
    }
  }
  return { instantNs, endInstantNs, bpm, sourceIds, sourceOrders };
}

function assertRowCount(rowCount: number): void {
  if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > MAX_CHUNK_ROWS) {
    throw new RangeError(`Chunk row count must be between 1 and ${MAX_CHUNK_ROWS}`);
  }
}

function validateRows(rows: readonly ExactReading[]): void {
  rows.forEach((row, index) => {
    if (row.instantNs < INT64_MIN || row.instantNs > INT64_MAX) {
      throw new RangeError("Chunk timestamp must fit a signed 64-bit integer");
    }
    const endInstantNs = row.endInstantNs ?? row.instantNs;
    if (endInstantNs < row.instantNs || endInstantNs > INT64_MAX) {
      throw new RangeError(
        "Chunk end timestamp must follow its start and fit a signed 64-bit integer",
      );
    }
    if (!isValidBpm(row.bpm))
      throw new RangeError("Chunk BPM must be finite and between 1 and 300");
    assertUint32(row.sourceId, "sourceId");
    assertUint32(row.sourceOrder, "sourceOrder");
    const previous = rows[index - 1];
    if (
      previous &&
      (previous.instantNs > row.instantNs ||
        (previous.instantNs === row.instantNs && previous.sourceOrder > row.sourceOrder))
    ) {
      throw new Error("Chunk rows must be monotonically ordered by instant and source order");
    }
  });
}

function isValidBpm(value: number): boolean {
  return Number.isFinite(value) && value >= 1 && value <= 300;
}

function assertUint32(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new RangeError(`${field} must be an unsigned 32-bit integer`);
  }
}
