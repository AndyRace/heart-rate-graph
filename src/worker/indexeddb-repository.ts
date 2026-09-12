import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  activeGenerationPointer,
  assertNonNegativeInteger,
  MAX_STAGING_RUN_ROWS,
  validateSourceGeneration,
  type ActiveGenerationPointer,
  type CandidateSourceGeneration,
  type ChunkDescriptor,
  type GenerationManifest,
  type GenerationStatus,
  type ReadingChunk,
  type ReadySourceGeneration,
  type SourceGeneration,
  type StagingRun,
} from "../domain/readings";
import { decodeReadingChunk } from "./chunk-codec";
import { validateGenerationManifest } from "./chunk-manifest";
import type { ActiveGeneration, ChunkRepository } from "./chunk-repository";

export const DATABASE_NAME = "heart-rate-graph";
export const DATABASE_VERSION = 2;

interface HeartRateGraphDatabase extends DBSchema {
  control: {
    key: string;
    value: ActiveGenerationPointer;
  };
  generations: {
    key: string;
    value: SourceGeneration;
    indexes: {
      "by-status": GenerationStatus;
      "by-source-digest": string;
    };
  };
  manifests: {
    key: string;
    value: GenerationManifest;
  };
  chunks: {
    key: [string, number];
    value: ReadingChunk;
    indexes: { "by-generation": string };
  };
  stagingRuns: {
    key: [string, number];
    value: StagingRun;
    indexes: { "by-generation": string };
  };
}

export class IndexedDbChunkRepository implements ChunkRepository {
  readonly retention = "persistent" as const;
  private closed = false;

  private constructor(readonly database: IDBPDatabase<HeartRateGraphDatabase>) {}

  static async open(): Promise<IndexedDbChunkRepository> {
    const databasePromise = openDB<HeartRateGraphDatabase>(DATABASE_NAME, DATABASE_VERSION, {
      upgrade(db) {
        for (const storeName of [...db.objectStoreNames]) db.deleteObjectStore(storeName);
        db.createObjectStore("control");
        const generations = db.createObjectStore("generations", { keyPath: "generationId" });
        generations.createIndex("by-status", "status");
        generations.createIndex("by-source-digest", "sourceDigest");
        db.createObjectStore("manifests", { keyPath: "generationId" });
        const chunks = db.createObjectStore("chunks", {
          keyPath: ["generationId", "chunkId"],
        });
        chunks.createIndex("by-generation", "generationId");
        const stagingRuns = db.createObjectStore("stagingRuns", {
          keyPath: ["generationId", "runId"],
        });
        stagingRuns.createIndex("by-generation", "generationId");
      },
      blocking() {
        void databasePromise.then((database) => database.close());
      },
    });
    const database = await databasePromise;
    const repository = new IndexedDbChunkRepository(database);
    await repository.reconcileStoredState();
    return repository;
  }

  async createGeneration(
    generation: CandidateSourceGeneration,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    validateSourceGeneration(generation);
    if (generation.retention !== "persistent") {
      throw new Error("IndexedDB repositories only accept persistent generations");
    }
    await this.database.add("generations", generation);
    signal?.throwIfAborted();
  }

  async updateGeneration(
    generation: CandidateSourceGeneration,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    validateSourceGeneration(generation);
    const previous = await this.database.get("generations", generation.generationId);
    signal?.throwIfAborted();
    if (!previous || previous.status === "ready")
      throw new Error("Candidate generation does not exist");
    if (!isCandidateTransition(previous.status, generation.status)) {
      throw new Error(
        `Invalid generation transition from ${previous.status} to ${generation.status}`,
      );
    }
    await this.database.put("generations", generation);
  }

  async getGeneration(
    generationId: string,
    signal?: AbortSignal,
  ): Promise<SourceGeneration | undefined> {
    signal?.throwIfAborted();
    const generation = await this.database.get("generations", generationId);
    signal?.throwIfAborted();
    return generation;
  }

  async putStagingRun(run: StagingRun, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    assertNonNegativeInteger(run.runId, "runId");
    if (
      !Number.isInteger(run.rowCount) ||
      run.rowCount < 1 ||
      run.rowCount > MAX_STAGING_RUN_ROWS
    ) {
      throw new RangeError(`Staging run row count must be between 1 and ${MAX_STAGING_RUN_ROWS}`);
    }
    if (run.minimumInstantNs > run.maximumInstantNs)
      throw new RangeError("Staging run range is invalid");
    await this.requireCandidate(run.generationId);
    signal?.throwIfAborted();
    await this.database.add("stagingRuns", run);
  }

  async readStagingRun(
    generationId: string,
    runId: number,
    signal?: AbortSignal,
  ): Promise<StagingRun | undefined> {
    signal?.throwIfAborted();
    const run = await this.database.get("stagingRuns", [generationId, runId]);
    signal?.throwIfAborted();
    return run;
  }

  async listStagingRuns(
    generationId: string,
    signal?: AbortSignal,
  ): Promise<readonly StagingRun[]> {
    signal?.throwIfAborted();
    const runs = await this.database.getAllFromIndex("stagingRuns", "by-generation", generationId);
    signal?.throwIfAborted();
    return runs.sort((left, right) => left.runId - right.runId);
  }

  async deleteStagingRun(generationId: string, runId: number, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    await this.database.delete("stagingRuns", [generationId, runId]);
  }

  async putChunk(chunk: ReadingChunk, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    await this.requireCandidate(chunk.generationId);
    validateChunk(chunk, 0x1_0000_0000);
    signal?.throwIfAborted();
    await this.database.add("chunks", chunk);
  }

  async readChunk(
    generationId: string,
    chunkId: number,
    signal?: AbortSignal,
  ): Promise<ReadingChunk | undefined> {
    signal?.throwIfAborted();
    const chunk = await this.database.get("chunks", [generationId, chunkId]);
    signal?.throwIfAborted();
    return chunk;
  }

  async publishGeneration(
    generation: ReadySourceGeneration,
    manifest: GenerationManifest,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    validateSourceGeneration(generation);
    validateGenerationManifest(manifest);
    if (generation.retention !== "persistent") throw new Error("Publication must be persistent");
    if (generation.generationId !== manifest.generationId) {
      throw new Error("Generation and manifest identities disagree");
    }
    const candidate = await this.database.get("generations", generation.generationId);
    if (!candidate || candidate.status !== "finalizing") {
      throw new Error("Publication requires an existing finalizing candidate");
    }
    validatePublicationMetadata(candidate, generation, manifest);
    const chunks = await this.database.getAllFromIndex(
      "chunks",
      "by-generation",
      generation.generationId,
    );
    if (chunks.length !== manifest.chunks.length)
      throw new Error("Publication is missing chunk data");
    for (const descriptor of manifest.chunks) {
      const chunk = chunks.find((value) => value.chunkId === descriptor.chunkId);
      if (!chunk) throw new Error(`Publication is missing chunk ${descriptor.chunkId}`);
      if (!descriptorMatchesChunk(descriptor, chunk)) {
        throw new Error(`Manifest metadata disagrees with chunk ${descriptor.chunkId}`);
      }
      validateChunk(chunk, manifest.sourceTable.length);
    }
    signal?.throwIfAborted();

    const transaction = this.database.transaction(
      ["generations", "manifests", "control"],
      "readwrite",
    );
    void transaction.objectStore("manifests").add(manifest);
    void transaction.objectStore("generations").put(generation);
    void transaction
      .objectStore("control")
      .put(activeGenerationPointer(generation, generation.completedAt), "active-generation");
    await transaction.done;
  }

  async getActiveManifest(signal?: AbortSignal): Promise<ActiveGeneration | undefined> {
    signal?.throwIfAborted();
    const pointer = await this.database.get("control", "active-generation");
    if (!pointer) return undefined;
    return this.readValidatedGeneration(pointer.generationId, signal);
  }

  async discardGeneration(generationId: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const pointer = await this.database.get("control", "active-generation");
    if (pointer?.generationId === generationId)
      throw new Error("The active generation cannot be discarded");
    await this.deleteGenerationRecords(generationId);
  }

  async cleanupAbandonedGenerations(limit: number, signal?: AbortSignal): Promise<number> {
    assertNonNegativeInteger(limit, "limit");
    const pointer = await this.database.get("control", "active-generation");
    const generations = await this.database.getAll("generations");
    const abandoned = generations
      .filter((generation) => generation.generationId !== pointer?.generationId)
      .slice(0, limit);
    for (const generation of abandoned) {
      signal?.throwIfAborted();
      await this.deleteGenerationRecords(generation.generationId);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return abandoned.length;
  }

  async clear(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.closed) return;
    const databaseName = this.database.name;
    this.database.close();
    this.closed = true;
    await deleteDatabase(databaseName);
  }

  close(): Promise<void> {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
    }
    return Promise.resolve();
  }

  static async delete(): Promise<void> {
    await deleteDatabase(DATABASE_NAME);
  }

  private async reconcileStoredState(): Promise<void> {
    const pointer = await this.database.get("control", "active-generation");
    let activeGenerationId: string | undefined;
    if (pointer) {
      try {
        await this.readValidatedGeneration(pointer.generationId);
        activeGenerationId = pointer.generationId;
      } catch {
        await this.deleteGenerationRecords(pointer.generationId, true);
      }
    }
    const generationIds = (await this.database.getAllKeys("generations")) as string[];
    for (const generationId of generationIds) {
      if (generationId === activeGenerationId) continue;
      await this.deleteGenerationRecords(generationId);
    }
  }

  private async readValidatedGeneration(
    generationId: string,
    signal?: AbortSignal,
  ): Promise<ActiveGeneration> {
    const [generation, manifest] = await Promise.all([
      this.database.get("generations", generationId),
      this.database.get("manifests", generationId),
    ]);
    signal?.throwIfAborted();
    if (!generation || generation.status !== "ready" || !manifest) {
      throw new Error("Active index is incomplete or corrupt");
    }
    validateSourceGeneration(generation);
    validateGenerationManifest(manifest);
    return { generation, manifest };
  }

  private async deleteGenerationRecords(generationId: string, clearPointer = false): Promise<void> {
    const [chunkKeys, runKeys] = await Promise.all([
      this.database.getAllKeysFromIndex("chunks", "by-generation", generationId),
      this.database.getAllKeysFromIndex("stagingRuns", "by-generation", generationId),
    ]);
    const transaction = this.database.transaction(
      clearPointer
        ? ["control", "generations", "manifests", "chunks", "stagingRuns"]
        : ["generations", "manifests", "chunks", "stagingRuns"],
      "readwrite",
    );
    if (clearPointer) {
      void transaction.objectStore("control").delete("active-generation");
    }
    void transaction.objectStore("generations").delete(generationId);
    void transaction.objectStore("manifests").delete(generationId);
    for (const key of chunkKeys) void transaction.objectStore("chunks").delete(key);
    for (const key of runKeys) void transaction.objectStore("stagingRuns").delete(key);
    await transaction.done;
  }

  private async requireCandidate(generationId: string): Promise<void> {
    const generation = await this.database.get("generations", generationId);
    if (!generation || generation.status === "ready")
      throw new Error("Candidate generation does not exist");
  }
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("IndexedDB deletion failed"));
    request.onblocked = () =>
      reject(new DOMException("Database deletion was blocked", "ClearBlockedError"));
  });
}

function validateChunk(chunk: ReadingChunk, sourceTableLength: number): void {
  if (chunk.byteLength !== chunk.payload.byteLength)
    throw new Error("Chunk byte length is invalid");
  const decoded = decodeReadingChunk(chunk.payload, {
    checksum: chunk.checksum,
    rowCount: chunk.rowCount,
    sourceTableLength,
  });
  if (
    decoded.instantNs[0] !== chunk.minimumInstantNs ||
    decoded.instantNs.at(-1) !== chunk.maximumInstantNs ||
    decoded.sourceOrders[0] !== chunk.firstSourceOrder ||
    decoded.sourceOrders.at(-1) !== chunk.lastSourceOrder
  ) {
    throw new Error("Chunk metadata disagrees with its payload");
  }
}

function validatePublicationMetadata(
  candidate: SourceGeneration,
  generation: ReadySourceGeneration,
  manifest: GenerationManifest,
): void {
  if (candidate.sourceDigest !== null && candidate.sourceDigest !== generation.sourceDigest) {
    throw new Error("Published source digest disagrees with the candidate");
  }
  if (
    generation.chunkCount !== manifest.chunks.length ||
    generation.acceptedCount !== manifest.acceptedCount ||
    generation.validationCounts.accepted !== manifest.acceptedCount
  ) {
    throw new Error("Published generation counts disagree with the manifest");
  }
  if (
    generation.minimumInstantNs !== (manifest.chunks[0]?.minimumInstantNs ?? null) ||
    generation.maximumInstantNs !== (manifest.chunks.at(-1)?.maximumInstantNs ?? null)
  ) {
    throw new Error("Published generation bounds disagree with the manifest");
  }
}

function descriptorMatchesChunk(descriptor: ChunkDescriptor, chunk: ReadingChunk): boolean {
  return (
    descriptor.chunkId === chunk.chunkId &&
    descriptor.rowCount === chunk.rowCount &&
    descriptor.byteLength === chunk.byteLength &&
    descriptor.minimumInstantNs === chunk.minimumInstantNs &&
    descriptor.maximumInstantNs === chunk.maximumInstantNs &&
    descriptor.firstSourceOrder === chunk.firstSourceOrder &&
    descriptor.lastSourceOrder === chunk.lastSourceOrder &&
    descriptor.checksum === chunk.checksum
  );
}

function isCandidateTransition(
  from: SourceGeneration["status"],
  to: CandidateSourceGeneration["status"],
): boolean {
  if (from === to) return true;
  if (from === "indexing") return to === "finalizing" || to === "cancelled" || to === "failed";
  if (from === "finalizing") return to === "failed";
  return to === "deleted";
}
