import type { DecodedChunkColumns } from "../domain/readings";

export const DEFAULT_CHUNK_CACHE_BUDGET_BYTES = 16 * 1024 * 1024;

const ENTRY_OVERHEAD_BYTES = 128;

export interface ChunkCacheDiagnosticEntry {
  readonly generationId: string;
  readonly chunkId: number;
  readonly byteWeight: number;
  readonly pinCount: number;
}

export interface ChunkCacheStats {
  hits: number;
  misses: number;
  evictions: number;
}

export interface PutOptions {
  readonly pinned?: boolean;
}

interface CacheEntry {
  columns: DecodedChunkColumns;
  byteWeight: number;
  lastAccessSequence: number;
  pinCount: number;
}

export function chunkColumnsByteWeight(columns: DecodedChunkColumns): number {
  return (
    columns.instantNs.byteLength +
    columns.endInstantNs.byteLength +
    columns.bpm.byteLength +
    columns.sourceIds.byteLength +
    columns.sourceOrders.byteLength +
    ENTRY_OVERHEAD_BYTES
  );
}

function cacheKey(generationId: string, chunkId: number): string {
  return `${generationId}\u0000${chunkId}`;
}

function splitCacheKey(key: string): { generationId: string; chunkId: number } {
  const separator = key.indexOf("\u0000");
  return { generationId: key.slice(0, separator), chunkId: Number(key.slice(separator + 1)) };
}

/**
 * Byte-weighted decoded-chunk cache keyed by `(generationId, chunkId)`.
 *
 * Unpinned entries are evicted least-recently-used first once the byte-weighted budget is
 * exceeded. Pinned entries (active foreground/prefetch reads) are never evicted, even when a
 * single entry's weight alone exceeds the budget; such oversized entries are evicted as soon as
 * they become unpinned because they can never coexist with anything else inside the budget.
 */
export class ChunkLru {
  readonly stats: ChunkCacheStats = { hits: 0, misses: 0, evictions: 0 };
  private readonly entries = new Map<string, CacheEntry>();
  private sequence = 0;
  private totalBytes = 0;

  constructor(readonly budgetBytes: number = DEFAULT_CHUNK_CACHE_BUDGET_BYTES) {
    if (!Number.isSafeInteger(budgetBytes) || budgetBytes <= 0) {
      throw new RangeError("budgetBytes must be a positive integer");
    }
  }

  get currentBytes(): number {
    return this.totalBytes;
  }

  get pinnedBytes(): number {
    let total = 0;
    for (const entry of this.entries.values()) if (entry.pinCount > 0) total += entry.byteWeight;
    return total;
  }

  get size(): number {
    return this.entries.size;
  }

  get(generationId: string, chunkId: number): DecodedChunkColumns | undefined {
    const entry = this.entries.get(cacheKey(generationId, chunkId));
    if (!entry) {
      this.stats.misses += 1;
      return undefined;
    }
    this.stats.hits += 1;
    entry.lastAccessSequence = this.nextSequence();
    return entry.columns;
  }

  put(
    generationId: string,
    chunkId: number,
    columns: DecodedChunkColumns,
    byteWeight: number = chunkColumnsByteWeight(columns),
    options?: PutOptions,
  ): void {
    if (!Number.isSafeInteger(byteWeight) || byteWeight < 0) {
      throw new RangeError("byteWeight must be a non-negative integer");
    }
    const key = cacheKey(generationId, chunkId);
    const existing = this.entries.get(key);
    if (existing) this.totalBytes -= existing.byteWeight;
    const pinCount = (existing?.pinCount ?? 0) + (options?.pinned ? 1 : 0);
    this.entries.set(key, {
      columns,
      byteWeight,
      lastAccessSequence: this.nextSequence(),
      pinCount,
    });
    this.totalBytes += byteWeight;
    this.evictToBudget();
  }

  pin(generationId: string, chunkId: number): void {
    const entry = this.entries.get(cacheKey(generationId, chunkId));
    if (entry) entry.pinCount += 1;
  }

  unpin(generationId: string, chunkId: number): void {
    const entry = this.entries.get(cacheKey(generationId, chunkId));
    if (!entry || entry.pinCount === 0) return;
    entry.pinCount -= 1;
    this.evictToBudget();
  }

  invalidateGeneration(generationId: string): void {
    const prefix = `${generationId}\u0000`;
    for (const [key, entry] of [...this.entries]) {
      if (!key.startsWith(prefix)) continue;
      this.entries.delete(key);
      this.totalBytes -= entry.byteWeight;
    }
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  diagnostics(): readonly ChunkCacheDiagnosticEntry[] {
    return [...this.entries.entries()].map(([key, entry]) => ({
      ...splitCacheKey(key),
      byteWeight: entry.byteWeight,
      pinCount: entry.pinCount,
    }));
  }

  private nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  private evictToBudget(): void {
    // Oversized unpinned entries can never fit alongside anything else; drop them first,
    // regardless of recency, so they don't force out otherwise-reusable smaller entries.
    for (const [key, entry] of [...this.entries]) {
      if (entry.pinCount === 0 && entry.byteWeight > this.budgetBytes) {
        this.entries.delete(key);
        this.totalBytes -= entry.byteWeight;
        this.stats.evictions += 1;
      }
    }
    while (this.totalBytes > this.budgetBytes) {
      let victimKey: string | undefined;
      let victimSequence = Infinity;
      for (const [key, entry] of this.entries) {
        if (entry.pinCount > 0) continue;
        if (entry.lastAccessSequence < victimSequence) {
          victimSequence = entry.lastAccessSequence;
          victimKey = key;
        }
      }
      if (!victimKey) break; // remaining entries are all pinned
      const victim = this.entries.get(victimKey)!;
      this.entries.delete(victimKey);
      this.totalBytes -= victim.byteWeight;
      this.stats.evictions += 1;
    }
  }
}
