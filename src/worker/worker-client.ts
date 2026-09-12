import type { RangeCorrelation, Retention } from "../domain/readings";
import type {
  LegacyWorkerCommand,
  RangeCommand,
  WorkerCommand,
  WorkerEvent,
} from "../shared/worker-messages";

export type WorkerFactory = () => Worker;

export class WorkerClient {
  private activeWorker?: Worker;
  private stagingWorker?: Worker;
  private activeDatasetId?: string;
  private activeGenerationId?: string;
  private activeIndex?: { datasetId: string; generationId: string; requestId: string };
  private readonly latestRequests = new Map<string, string>();
  private readonly latestRanges = new Map<string, RangeCorrelation>();
  private activeRange?: RangeCorrelation;
  private readonly listeners = new Set<(event: WorkerEvent) => void>();

  constructor(
    private readonly workerFactory: WorkerFactory = () =>
      new Worker(new URL("./import-worker.ts", import.meta.url), { type: "module" }),
  ) {}

  subscribe(listener: (event: WorkerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  openActive(): string {
    const worker = this.ensureWorker();
    const requestId = crypto.randomUUID();
    this.latestRequests.set("index.open-active", requestId);
    worker.postMessage({ type: "index.open-active", requestId } satisfies WorkerCommand);
    return requestId;
  }

  startIndex(
    file: File,
    retention: Retention,
  ): {
    readonly datasetId: string;
    readonly generationId: string;
    readonly requestId: string;
  } {
    const worker = this.ensureWorker();
    this.latestRequests.delete("index.open-active");
    const operation = {
      datasetId: crypto.randomUUID(),
      generationId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
    };
    this.activeIndex = operation;
    this.latestRequests.set("index", operation.requestId);
    worker.postMessage({
      type: "index.start",
      ...operation,
      file,
      retention,
    } satisfies WorkerCommand);
    return operation;
  }

  cancelIndex(): void {
    if (!this.activeIndex || !this.activeWorker) return;
    this.activeWorker.postMessage({
      type: "index.cancel",
      ...this.activeIndex,
    } satisfies WorkerCommand);
  }

  loadRange(command: Extract<RangeCommand, { type: "range.load" }>): void {
    if (!this.activeWorker) throw new Error("No active index worker");
    if (this.activeRange) {
      this.activeWorker.postMessage({
        type: "range.cancel",
        correlation: this.activeRange,
        reason: "superseded",
      } satisfies WorkerCommand);
    }
    this.latestRanges.set(command.correlation.viewId, command.correlation);
    this.activeRange = command.correlation;
    this.activeWorker.postMessage(command);
  }

  prefetchRange(command: Extract<RangeCommand, { type: "range.prefetch" }>): void {
    if (!this.activeWorker) throw new Error("No active index worker");
    this.activeWorker.postMessage(command);
  }

  cancelRange(correlation: RangeCorrelation, reason: "superseded" | "unmounted" | "user"): void {
    this.activeWorker?.postMessage({
      type: "range.cancel",
      correlation,
      reason,
    } satisfies WorkerCommand);
  }

  startImport(file: File, sessionId: string): string {
    this.stagingWorker?.terminate();
    const worker = this.workerFactory();
    this.stagingWorker = worker;
    const requestId = crypto.randomUUID();
    this.latestRequests.set(`import:${sessionId}`, requestId);
    worker.onmessage = (message: MessageEvent<WorkerEvent>) => this.receive(worker, message.data);
    worker.onerror = () =>
      this.emit({
        type: "import.failed",
        requestId,
        sessionId,
        code: "worker-failed",
        message: "The import worker stopped unexpectedly.",
      });
    worker.postMessage({
      type: "import.start",
      requestId,
      sessionId,
      file,
      acceptedRecordLimit: 1_000_000,
    } satisfies WorkerCommand);
    return requestId;
  }

  cancelImport(sessionId: string): void {
    const requestId = this.latestRequests.get(`import:${sessionId}`);
    if (requestId && this.stagingWorker)
      this.stagingWorker.postMessage({
        type: "import.cancel",
        requestId,
        sessionId,
      } satisfies WorkerCommand);
  }

  query(command: Exclude<LegacyWorkerCommand, { type: "import.start" | "import.cancel" }>): void {
    if (!this.activeWorker) throw new Error("No active dataset");
    const key = command.type === "range.query" ? "range" : command.type;
    this.latestRequests.set(key, command.requestId);
    this.activeWorker.postMessage(command);
  }

  clear(): string {
    const worker = this.ensureWorker();
    const requestId = crypto.randomUUID();
    this.latestRequests.set("index.clear", requestId);
    worker.postMessage({ type: "index.clear", requestId } satisfies WorkerCommand);
    return requestId;
  }

  dispose(): void {
    if (this.activeWorker && this.activeRange) {
      this.activeWorker.postMessage({
        type: "range.cancel",
        correlation: this.activeRange,
        reason: "unmounted",
      } satisfies WorkerCommand);
    }
    this.activeWorker?.terminate();
    if (this.stagingWorker !== this.activeWorker) this.stagingWorker?.terminate();
    this.activeWorker = undefined;
    this.stagingWorker = undefined;
    this.activeDatasetId = undefined;
    this.activeGenerationId = undefined;
    this.activeIndex = undefined;
    this.activeRange = undefined;
    this.latestRanges.clear();
  }

  private receive(worker: Worker, event: WorkerEvent): void {
    if (event.type === "index.ready") {
      const expected = this.latestRequests.get("index");
      const opening = this.latestRequests.get("index.open-active");
      if (event.requestId !== expected && event.requestId !== opening) return;
      this.activeWorker = worker;
      this.activeDatasetId = event.datasetId;
      this.activeGenerationId = event.generationId;
      this.activeIndex = undefined;
      this.emit(event);
      return;
    }
    if (event.type.startsWith("index.") && "requestId" in event) {
      const expected =
        event.type === "index.unavailable"
          ? this.latestRequests.get("index.open-active")
          : event.type === "index.cleared" || event.type === "index.clear-failed"
            ? this.latestRequests.get("index.clear")
            : this.latestRequests.get("index");
      if (
        event.type !== "index.cleared" &&
        event.type !== "index.clear-failed" &&
        event.requestId !== expected
      )
        return;
      if (event.type === "index.failed" || event.type === "index.cancelled")
        this.activeIndex = undefined;
      if (event.type === "index.cleared") {
        this.activeDatasetId = undefined;
        this.activeGenerationId = undefined;
        this.activeIndex = undefined;
        this.activeRange = undefined;
        this.latestRanges.clear();
      }
      this.emit(event);
      return;
    }
    if ("correlation" in event) {
      const correlation = event.correlation;
      const expected = this.latestRanges.get(correlation.viewId);
      if (event.type === "range.prefetched") {
        if (
          correlation.datasetId !== this.activeDatasetId ||
          correlation.generationId !== this.activeGenerationId
        )
          return;
        this.emit(event);
        return;
      }
      if (
        !expected ||
        !correlationsEqual(correlation, expected) ||
        correlation.datasetId !== this.activeDatasetId ||
        correlation.generationId !== this.activeGenerationId
      )
        return;
      if (
        event.type === "range.cancelled" ||
        event.type === "range.failed" ||
        (event.type === "range.snapshot" && event.snapshot.status !== "partial")
      ) {
        if (this.activeRange && correlationsEqual(correlation, this.activeRange)) {
          this.activeRange = undefined;
        }
      }
      this.emit(event);
      return;
    }
    if (event.type.startsWith("import.")) {
      if (
        !("sessionId" in event) ||
        this.latestRequests.get(`import:${event.sessionId}`) !== event.requestId
      )
        return;
      if (event.type === "import.ready") {
        const oldWorker = this.activeWorker;
        const oldDatasetId = this.activeDatasetId;
        this.activeWorker = worker;
        this.activeDatasetId = event.datasetId;
        this.stagingWorker = undefined;
        if (oldWorker && oldDatasetId) {
          oldWorker.postMessage({
            type: "dataset.dispose",
            requestId: crypto.randomUUID(),
            datasetId: oldDatasetId,
          } satisfies WorkerCommand);
          oldWorker.terminate();
        }
      } else if (event.type === "import.failed" || event.type === "import.cancelled") {
        worker.terminate();
        if (this.stagingWorker === worker) this.stagingWorker = undefined;
      }
      this.emit(event);
      return;
    }
    const legacyEvent = event as Exclude<WorkerEvent, { readonly correlation: unknown }>;
    const key =
      legacyEvent.type === "range.result" ? "range" : legacyEvent.type.replace(".result", "");
    if (this.latestRequests.get(key) !== legacyEvent.requestId) return;
    if ("datasetId" in event && event.datasetId && event.datasetId !== this.activeDatasetId) return;
    this.emit(event);
  }

  private emit(event: WorkerEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }

  private ensureWorker(): Worker {
    if (this.activeWorker) return this.activeWorker;
    const worker = this.workerFactory();
    worker.onmessage = (message: MessageEvent<WorkerEvent>) => this.receive(worker, message.data);
    worker.onerror = () =>
      this.emit({
        type: "index.unavailable",
        requestId: this.latestRequests.get("index.open-active") ?? crypto.randomUUID(),
        error: {
          code: "storage-unavailable",
          message: "Local storage is unavailable.",
          recoverable: true,
          actions: ["retry", "use-session-storage"],
        },
      });
    this.activeWorker = worker;
    return worker;
  }
}

function correlationsEqual(left: RangeCorrelation, right: RangeCorrelation): boolean {
  return (
    left.datasetId === right.datasetId &&
    left.generationId === right.generationId &&
    left.viewId === right.viewId &&
    left.requestId === right.requestId &&
    left.rangeRevision === right.rangeRevision
  );
}
