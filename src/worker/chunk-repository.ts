import type {
  CandidateSourceGeneration,
  GenerationManifest,
  ReadingChunk,
  ReadySourceGeneration,
  StagingRun,
} from "../domain/readings";

export interface ActiveGeneration {
  readonly generation: ReadySourceGeneration;
  readonly manifest: GenerationManifest;
}

export interface ChunkRepository {
  readonly retention: "persistent" | "session";

  createGeneration(generation: CandidateSourceGeneration, signal?: AbortSignal): Promise<void>;
  updateGeneration(generation: CandidateSourceGeneration, signal?: AbortSignal): Promise<void>;
  getGeneration(
    generationId: string,
    signal?: AbortSignal,
  ): Promise<CandidateSourceGeneration | ReadySourceGeneration | undefined>;

  putStagingRun(run: StagingRun, signal?: AbortSignal): Promise<void>;
  readStagingRun(
    generationId: string,
    runId: number,
    signal?: AbortSignal,
  ): Promise<StagingRun | undefined>;
  listStagingRuns(generationId: string, signal?: AbortSignal): Promise<readonly StagingRun[]>;
  deleteStagingRun(generationId: string, runId: number, signal?: AbortSignal): Promise<void>;

  putChunk(chunk: ReadingChunk, signal?: AbortSignal): Promise<void>;
  readChunk(
    generationId: string,
    chunkId: number,
    signal?: AbortSignal,
  ): Promise<ReadingChunk | undefined>;

  publishGeneration(
    generation: ReadySourceGeneration,
    manifest: GenerationManifest,
    signal?: AbortSignal,
  ): Promise<void>;
  getActiveManifest(signal?: AbortSignal): Promise<ActiveGeneration | undefined>;

  discardGeneration(generationId: string, signal?: AbortSignal): Promise<void>;
  cleanupAbandonedGenerations(limit: number, signal?: AbortSignal): Promise<number>;
  clear(signal?: AbortSignal): Promise<void>;
  close(): Promise<void>;
}
