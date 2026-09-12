import Tokenizer from "@streamparser/json/tokenizer.js";
import TokenParser from "@streamparser/json/tokenparser.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { RawGoogleFitRecord } from "../domain/validation";

type JsonRecord = Record<string, unknown>;
const PARSER_SLICE_BYTES = 2 * 1024 * 1024;

const yieldToWorkerQueue = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

class ExactNumberTokenizer extends Tokenizer {
  protected override parseNumber(numberText: string): number {
    return numberText as unknown as number;
  }
}

const asObject = (value: unknown): JsonRecord | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;

function adaptRecord(value: unknown): RawGoogleFitRecord {
  const record = asObject(value) ?? {};
  const fitValues = Array.isArray(record.fitValue) ? record.fitValue : undefined;
  const firstFitValue = asObject(fitValues?.[0]);
  const fitValue = asObject(firstFitValue?.value);
  const bpmToken = fitValue?.fpVal;
  return {
    dataTypeName: record.dataTypeName,
    startTimeNanosToken: record.startTimeNanos,
    endTimeNanosToken: record.endTimeNanos,
    bpmCandidate:
      typeof bpmToken === "string" && bpmToken.trim() !== "" ? Number(bpmToken) : bpmToken,
    originDataSourceId: record.originDataSourceId,
  };
}

export async function parseGoogleFitStream(
  stream: ReadableStream<Uint8Array>,
  onRecord?: (record: RawGoogleFitRecord) => void,
  signal?: AbortSignal,
  onBytes?: (bytes: Uint8Array) => void,
): Promise<RawGoogleFitRecord[]> {
  const records: RawGoogleFitRecord[] = [];
  let hasDataPoints = false;
  const tokenizer = new ExactNumberTokenizer({ numberBufferSize: 64 });
  const parser = new TokenParser({ paths: ["$.Data Points.*", "$"], keepStack: false });
  tokenizer.onToken = (token) => parser.write(token);
  parser.onValue = ({ value, key, stack }) => {
    if (typeof key === "number" && stack.length >= 2) {
      const record = adaptRecord(value);
      if (!onRecord) records.push(record);
      onRecord?.(record);
    } else if (key === undefined) {
      const root = asObject(value);
      hasDataPoints = Array.isArray(root?.["Data Points"]);
    }
  };

  const reader = stream.getReader();
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Import cancelled", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      onBytes?.(value);
      for (let offset = 0; offset < value.length; offset += PARSER_SLICE_BYTES) {
        if (signal?.aborted) throw new DOMException("Import cancelled", "AbortError");
        tokenizer.write(value.subarray(offset, offset + PARSER_SLICE_BYTES));
        await yieldToWorkerQueue();
      }
    }
    tokenizer.end();
    if (!parser.isEnded) throw new Error("incomplete-json");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof Error && error.message === "record-limit") throw error;
    throw new Error("invalid-json", { cause: error });
  } finally {
    reader.releaseLock();
  }
  if (!hasDataPoints) throw new Error("unsupported-schema");
  return records;
}

export async function parseGoogleFitSource(
  file: Pick<File, "size" | "stream">,
  onRecord: (record: RawGoogleFitRecord) => void,
  signal?: AbortSignal,
): Promise<{ readonly bytesRead: number; readonly sourceDigest: string }> {
  const digest = sha256.create();
  let bytesRead = 0;
  await parseGoogleFitStream(file.stream(), onRecord, signal, (bytes) => {
    digest.update(bytes);
    bytesRead += bytes.byteLength;
  });
  return { bytesRead, sourceDigest: bytesToHex(digest.digest()) };
}
