import {
  MAX_STAGING_RUN_ROWS,
  assertNonNegativeInteger,
  validateSourceGeneration,
  type CandidateSourceGeneration,
  type ChunkDescriptor,
  type GenerationManifest,
  type ReadingChunk,
  type ReadySourceGeneration,
  type SourceGeneration,
  type StagingRun,
} from "../domain/readings";
import { decodeReadingChunk } from "./chunk-codec";
import { validateGenerationManifest } from "./chunk-manifest";
import type { ActiveGeneration, ChunkRepository } from "./chunk-repository";

const ALL_UINT32_VALUES = 0x1_0000_0000;

export class VolatileChunkRepository implements ChunkRepository {
  readonly retention = "session" as const;

  private readonly generations = new Map<string, SourceGeneration>();
  private readonly chunks = new Map<string, Map<number, ReadingChunk>>();
  private readonly stagingRuns = new Map<string, Map<number, StagingRun>>();
  private readonly manifests = new Map<string, GenerationManifest>();
  private activeGenerationId?: string;
  private closed = false;

  async createGeneration(
    generation: CandidateSourceGeneration,
    signal?: AbortSignal,
  ): Promise<void> {
    this.assertAvailable(signal);
    validateSourceGeneration(generation);
    if (generation.retention !== "session") {
      throw new Error("Volatile repositories only accept session generations");
    }
    if (generation.status === "deleted") {
      throw new Error("A new generation must be an unpublished candidate");
    }
    if (this.generations.has(generation.generationId)) throw new Error("Generation already exists");
    this.generations.set(generation.generationId, cloneGeneration(generation));
    this.chunks.set(generation.generationId, new Map());
    this.stagingRuns.set(generation.generationId, new Map());
  }

  async updateGeneration(
    generation: CandidateSourceGeneration,
    signal?: AbortSignal,
  ): Promise<void> {
    this.assertAvailable(signal);
    validateSourceGeneration(generation);
    if (generation.retention !== "session") {
      throw new Error("Volatile repositories only accept session generations");
    }
    const previous = this.generations.get(generation.generationId);
    if (!previous || previous.status === "ready")
      throw new Error("Candidate generation does not exist");
    if (!isCandidateTransition(previous.status, generation.status)) {
      throw new Error(
        `Invalid generation transition from ${previous.status} to ${generation.status}`,
      );
    }
    this.generations.set(generation.generationId, cloneGeneration(generation));
  }

  async getGeneration(
    generationId: string,
    signal?: AbortSignal,
  ): Promise<SourceGeneration | undefined> {
    this.assertAvailable(signal);
    const generation = this.generations.get(generationId);
    return generation ? cloneGeneration(generation) : undefined;
  }

  async putStagingRun(run: StagingRun, signal?: AbortSignal): Promise<void> {
    this.assertAvailable(signal);
    const runs = this.requireCandidateMap(this.stagingRuns, run.generationId);
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
    if (runs.has(run.runId)) throw new Error("Staging run already exists");
    runs.set(run.runId, cloneStagingRun(run));
  }

  async readStagingRun(
    generationId: string,
    runId: number,
    signal?: AbortSignal,
  ): Promise<StagingRun | undefined> {
    this.assertAvailable(signal);
    const run = this.stagingRuns.get(generationId)?.get(runId);
    return run ? cloneStagingRun(run) : undefined;
  }

  async listStagingRuns(
    generationId: string,
    signal?: AbortSignal,
  ): Promise<readonly StagingRun[]> {
    this.assertAvailable(signal);
    return [...(this.stagingRuns.get(generationId)?.values() ?? [])]
      .sort((left, right) => left.runId - right.runId)
      .map(cloneStagingRun);
  }

  async deleteStagingRun(generationId: string, runId: number, signal?: AbortSignal): Promise<void> {
    this.assertAvailable(signal);
    this.stagingRuns.get(generationId)?.delete(runId);
  }

  async putChunk(chunk: ReadingChunk, signal?: AbortSignal): Promise<void> {
    this.assertAvailable(signal);
    const chunks = this.requireCandidateMap(this.chunks, chunk.generationId);
    if (chunk.byteLength !== chunk.payload.byteLength)
      throw new Error("Chunk byte length is invalid");
    const decoded = decodeReadingChunk(chunk.payload, {
      checksum: chunk.checksum,
      rowCount: chunk.rowCount,
      sourceTableLength: ALL_UINT32_VALUES,
    });
    if (
      decoded.instantNs[0] !== chunk.minimumInstantNs ||
      decoded.instantNs[decoded.instantNs.length - 1] !== chunk.maximumInstantNs ||
      decoded.sourceOrders[0] !== chunk.firstSourceOrder ||
      decoded.sourceOrders[decoded.sourceOrders.length - 1] !== chunk.lastSourceOrder
    ) {
      throw new Error("Chunk metadata disagrees with its payload");
    }
    if (chunks.has(chunk.chunkId)) throw new Error("Chunk already exists");
    chunks.set(chunk.chunkId, cloneChunk(chunk));
  }

  async readChunk(
    generationId: string,
    chunkId: number,
    signal?: AbortSignal,
  ): Promise<ReadingChunk | undefined> {
    this.assertAvailable(signal);
    const chunk = this.chunks.get(generationId)?.get(chunkId);
    return chunk ? cloneChunk(chunk) : undefined;
  }

  async publishGeneration(
    generation: ReadySourceGeneration,
    manifest: GenerationManifest,
    signal?: AbortSignal,
  ): Promise<void> {
    this.assertAvailable(signal);
    validateSourceGeneration(generation);
    validateGenerationManifest(manifest);
    if (generation.retention !== "session")
      throw new Error("Volatile publication must use session retention");
    if (generation.generationId !== manifest.generationId) {
      throw new Error("Generation and manifest identities disagree");
    }
    const candidate = this.generations.get(generation.generationId);
    if (!candidate || candidate.status !== "finalizing") {
      throw new Error("Publication requires an existing finalizing candidate");
    }
    validatePublicationMetadata(candidate, generation, manifest);
    const chunks = this.chunks.get(generation.generationId)!;
    for (const descriptor of manifest.chunks) {
      const chunk = chunks.get(descriptor.chunkId);
      if (!chunk) throw new Error(`Publication is missing chunk ${descriptor.chunkId}`);
      if (!descriptorMatchesChunk(descriptor, chunk)) {
        throw new Error(`Manifest metadata disagrees with chunk ${descriptor.chunkId}`);
      }
      decodeReadingChunk(chunk.payload, {
        checksum: descriptor.checksum,
        rowCount: descriptor.rowCount,
        sourceTableLength: manifest.sourceTable.length,
      });
    }
    if (chunks.size !== manifest.chunks.length)
      throw new Error("Publication contains unmanifested chunks");
    this.assertAvailable(signal);

    this.generations.set(generation.generationId, cloneGeneration(generation));
    this.manifests.set(generation.generationId, cloneManifest(manifest));
    this.stagingRuns.delete(generation.generationId);
    this.activeGenerationId = generation.generationId;
  }

  async getActiveManifest(signal?: AbortSignal): Promise<ActiveGeneration | undefined> {
    this.assertAvailable(signal);
    if (!this.activeGenerationId) return undefined;
    const generation = this.generations.get(this.activeGenerationId);
    const manifest = this.manifests.get(this.activeGenerationId);
    if (!generation || generation.status !== "ready" || !manifest) return undefined;
    validateSourceGeneration(generation);
    validateGenerationManifest(manifest);
    return { generation: cloneGeneration(generation), manifest: cloneManifest(manifest) };
  }

  async discardGeneration(generationId: string, signal?: AbortSignal): Promise<void> {
    this.assertAvailable(signal);
    if (generationId === this.activeGenerationId)
      throw new Error("The active generation cannot be discarded");
    this.deleteGeneration(generationId);
  }

  async cleanupAbandonedGenerations(limit: number, signal?: AbortSignal): Promise<number> {
    this.assertAvailable(signal);
    assertNonNegativeInteger(limit, "limit");
    let removed = 0;
    for (const generationId of this.generations.keys()) {
      if (removed >= limit) break;
      if (generationId !== this.activeGenerationId) {
        this.deleteGeneration(generationId);
        removed += 1;
      }
    }
    return removed;
  }

  async clear(signal?: AbortSignal): Promise<void> {
    this.assertAvailable(signal);
    this.clearState();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.clearState();
    this.closed = true;
  }

  private requireCandidateMap<T>(
    collection: Map<string, Map<number, T>>,
    generationId: string,
  ): Map<number, T> {
    const generation = this.generations.get(generationId);
    const values = collection.get(generationId);
    if (!generation || !values) throw new Error("Candidate generation does not exist");
    if (generation.status === "ready") throw new Error("Published generations are immutable");
    return values;
  }

  private deleteGeneration(generationId: string): void {
    this.generations.delete(generationId);
    this.chunks.delete(generationId);
    this.stagingRuns.delete(generationId);
    this.manifests.delete(generationId);
  }

  private clearState(): void {
    this.generations.clear();
    this.chunks.clear();
    this.stagingRuns.clear();
    this.manifests.clear();
    this.activeGenerationId = undefined;
  }

  private assertAvailable(signal?: AbortSignal): void {
    if (this.closed) throw new Error("Volatile repository is closed");
    signal?.throwIfAborted();
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
  const minimum = manifest.chunks[0]?.minimumInstantNs ?? null;
  const maximum = manifest.chunks.at(-1)?.maximumInstantNs ?? null;
  if (generation.minimumInstantNs !== minimum || generation.maximumInstantNs !== maximum) {
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

function cloneGeneration<T extends SourceGeneration>(generation: T): T {
  return { ...generation, validationCounts: { ...generation.validationCounts } };
}

function cloneChunk(chunk: ReadingChunk): ReadingChunk {
  return { ...chunk, payload: chunk.payload.slice(0) };
}

function cloneStagingRun(run: StagingRun): StagingRun {
  return { ...run, payload: run.payload.slice(0) };
}

function cloneManifest(manifest: GenerationManifest): GenerationManifest {
  return Object.freeze({
    ...manifest,
    chunks: Object.freeze(manifest.chunks.map((chunk) => Object.freeze({ ...chunk }))),
    sourceTable: Object.freeze([...manifest.sourceTable]),
    validationCounts: Object.freeze({ ...manifest.validationCounts }),
  });
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
