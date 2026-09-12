import { describe, expect, it } from "vitest";
import {
  ChunkLru,
  DEFAULT_CHUNK_CACHE_BUDGET_BYTES,
  chunkColumnsByteWeight,
} from "../../src/worker/chunk-lru";
import type { DecodedChunkColumns } from "../../src/domain/readings";

function columns(rowCount = 1): DecodedChunkColumns {
  return {
    instantNs: new BigInt64Array(rowCount),
    endInstantNs: new BigInt64Array(rowCount),
    bpm: new Float64Array(rowCount),
    sourceIds: new Uint32Array(rowCount),
    sourceOrders: new Uint32Array(rowCount),
  };
}

describe("ChunkLru", () => {
  it("defaults to a 16 MiB byte-weighted budget", () => {
    const cache = new ChunkLru();
    expect(cache.budgetBytes).toBe(16 * 1024 * 1024);
    expect(DEFAULT_CHUNK_CACHE_BUDGET_BYTES).toBe(16 * 1024 * 1024);
  });

  it("keys entries by the compound generation/chunk pair", () => {
    const cache = new ChunkLru();
    const first = columns();
    const second = columns();
    cache.put("generation-a", 0, first, 10);
    cache.put("generation-b", 0, second, 10);

    expect(cache.get("generation-a", 0)).toBe(first);
    expect(cache.get("generation-b", 0)).toBe(second);
    expect(cache.get("generation-a", 1)).toBeUndefined();
    expect(cache.size).toBe(2);
  });

  it("updates recency on access so a recently read entry survives eviction pressure", () => {
    const cache = new ChunkLru(30);
    cache.put("g", 0, columns(), 10);
    cache.put("g", 1, columns(), 10);
    cache.put("g", 2, columns(), 10);
    // Touch chunk 0 so it becomes the most-recently-used entry.
    cache.get("g", 0);

    cache.put("g", 3, columns(), 10);

    expect(cache.get("g", 0)).toBeDefined();
    expect(cache.get("g", 1)).toBeUndefined();
    expect(cache.stats.evictions).toBe(1);
  });

  it("never evicts a pinned foreground entry even under budget pressure", () => {
    const cache = new ChunkLru(20);
    cache.put("g", 0, columns(), 10, { pinned: true });
    cache.put("g", 1, columns(), 10);
    cache.put("g", 2, columns(), 10);

    expect(cache.get("g", 0)).toBeDefined();
    expect(cache.get("g", 1)).toBeUndefined();
  });

  it("evicts the least-recently-used unpinned entry once the budget is exceeded", () => {
    const cache = new ChunkLru(20);
    cache.put("g", 0, columns(), 10);
    cache.put("g", 1, columns(), 10);

    cache.put("g", 2, columns(), 10);

    expect(cache.get("g", 0)).toBeUndefined();
    expect(cache.get("g", 1)).toBeDefined();
    expect(cache.get("g", 2)).toBeDefined();
    expect(cache.stats.evictions).toBe(1);
  });

  it("keeps an oversized entry available while pinned and releases it once unpinned", () => {
    const cache = new ChunkLru(100);
    const oversized = columns();
    cache.put("g", 0, oversized, 1_000, { pinned: true });

    expect(cache.currentBytes).toBe(1_000);
    expect(cache.get("g", 0)).toBe(oversized);

    cache.unpin("g", 0);

    expect(cache.get("g", 0)).toBeUndefined();
    expect(cache.currentBytes).toBe(0);
    expect(cache.stats.evictions).toBe(1);
  });

  it("computes byte weight from the retained typed-array columns", () => {
    const weight = chunkColumnsByteWeight(columns(4));
    // 4 rows * (8 + 8 + 8 + 4 + 4) bytes plus fixed per-entry overhead.
    expect(weight).toBe(4 * 32 + 128);
  });

  it("removes only the entries belonging to an invalidated generation", () => {
    const cache = new ChunkLru();
    cache.put("gen-a", 0, columns(), 10);
    cache.put("gen-a", 1, columns(), 10);
    cache.put("gen-b", 0, columns(), 10);

    cache.invalidateGeneration("gen-a");

    expect(cache.get("gen-a", 0)).toBeUndefined();
    expect(cache.get("gen-a", 1)).toBeUndefined();
    expect(cache.get("gen-b", 0)).toBeDefined();
    expect(cache.currentBytes).toBe(10);
  });
});
