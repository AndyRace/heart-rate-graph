import { describe, expect, it, vi } from "vitest";
import { emptyValidationCounts, type RangeCorrelation } from "../../src/domain/readings";
import type { RangeEvent, WorkerCommand, WorkerEvent } from "../../src/shared/worker-messages";
import { WorkerClient } from "../../src/worker/worker-client";

class FakeWorker {
  onmessage: ((event: MessageEvent<WorkerEvent>) => void) | null = null;
  onerror: OnErrorEventHandler = null;
  postMessage = vi.fn<(message: WorkerCommand) => void>();
  terminate = vi.fn();

  emit(data: WorkerEvent) {
    this.onmessage?.({ data } as MessageEvent<WorkerEvent>);
  }
}

const correlation: RangeCorrelation = {
  datasetId: "dataset",
  generationId: "generation",
  viewId: "primary",
  requestId: "request-1",
  rangeRevision: 4,
};

function readyClient() {
  const worker = new FakeWorker();
  const client = new WorkerClient(() => worker as unknown as Worker);
  const events: WorkerEvent[] = [];
  client.subscribe((event) => events.push(event));
  const requestId = client.openActive();
  worker.emit({
    type: "index.ready",
    requestId,
    datasetId: correlation.datasetId,
    generationId: correlation.generationId,
    generation: {
      generationId: correlation.generationId,
      sourceDigest: "ab".repeat(32),
      fileName: "range.json",
      fileSize: 1,
      lastModified: 1,
      formatVersion: 1,
      retention: "session",
      status: "ready",
      startedAt: 1,
      completedAt: 2,
      acceptedCount: 0,
      duplicateCount: 0,
      validationCounts: emptyValidationCounts(),
      minimumInstantNs: null,
      maximumInstantNs: null,
      chunkCount: 0,
    },
    historyExtent: null,
    retention: "session",
  });
  events.length = 0;
  return { client, worker, events };
}

function loadCommand(
  nextCorrelation = correlation,
): Extract<WorkerCommand, { type: "range.load" }> {
  return {
    type: "range.load",
    correlation: nextCorrelation,
    range: { startInstantNs: 0n, endInstantNs: 10n },
    displayBudget: 100,
    page: { offset: 0, limit: 25 },
  };
}

function lifecycleEvents(): RangeEvent[] {
  const progress = { loadedChunkCount: 0, totalChunkCount: 1 };
  return [
    {
      type: "range.started",
      correlation,
      requestedRange: { startInstantNs: 0n, endInstantNs: 10n },
      selectedChunkCount: 1,
    },
    {
      type: "range.progress",
      correlation,
      requestedRange: { startInstantNs: 0n, endInstantNs: 10n },
      coveredIntervals: [],
      progress,
    },
    {
      type: "range.snapshot",
      correlation,
      snapshot: {
        ...correlation,
        requestedRange: { startInstantNs: 0n, endInstantNs: 10n },
        coveredIntervals: [{ startInstantNs: 0n, endInstantNs: 10n }],
        readingCount: 0,
        displaySeries: {
          timestamps: new Float64Array(),
          bpmValues: new Float64Array(),
          sourceIndexes: new Uint32Array(),
          gapBefore: new Uint8Array(),
          mode: "exact",
        },
        readingPage: { rangeRevision: 4, page: 1, pageSize: 25, totalRows: 0, rows: [] },
        progress,
        status: "empty",
        summary: null,
      },
    },
    { type: "range.cancelled", correlation, reason: "user" },
    {
      type: "range.failed",
      correlation,
      error: {
        code: "unexpected",
        message: "Range failed.",
        recoverable: true,
        actions: ["retry"],
      },
    },
  ];
}

it("rejects a late startup result after a new index starts", () => {
  const worker = new FakeWorker();
  const client = new WorkerClient(() => worker as unknown as Worker);
  const events: WorkerEvent[] = [];
  client.subscribe((event) => events.push(event));

  const openRequestId = client.openActive();
  client.startIndex(new File(["{}"], "session-only.json"), "session");
  worker.emit({ type: "index.unavailable", requestId: openRequestId });

  expect(events).toEqual([]);
});

describe("on-demand worker protocol", () => {
  it("forwards every range lifecycle event for the authoritative request", () => {
    const { client, worker, events } = readyClient();
    client.loadRange(loadCommand());

    for (const event of lifecycleEvents()) worker.emit(event);

    expect(events.map((event) => event.type)).toEqual([
      "range.started",
      "range.progress",
      "range.snapshot",
      "range.cancelled",
      "range.failed",
    ]);
  });

  it.each([
    ["datasetId", "stale-dataset"],
    ["generationId", "stale-generation"],
    ["viewId", "stale-view"],
    ["requestId", "stale-request"],
    ["rangeRevision", 3],
  ] as const)("rejects events with a stale %s", (field, value) => {
    const { client, worker, events } = readyClient();
    client.loadRange(loadCommand());
    const staleCorrelation = { ...correlation, [field]: value };

    worker.emit({
      type: "range.started",
      correlation: staleCorrelation,
      requestedRange: { startInstantNs: 0n, endInstantNs: 10n },
      selectedChunkCount: 1,
    });

    expect(events).toEqual([]);
  });

  it("cancels the sole prior foreground request before posting its replacement", () => {
    const { client, worker } = readyClient();
    client.loadRange(loadCommand());
    const replacement = { ...correlation, requestId: "request-2", rangeRevision: 5 };
    client.loadRange(loadCommand(replacement));

    expect(worker.postMessage.mock.calls.slice(-2).map(([message]) => message)).toEqual([
      { type: "range.cancel", correlation, reason: "superseded" },
      loadCommand(replacement),
    ]);
  });

  it("cancels the active foreground request at the unmount checkpoint", () => {
    const { client, worker } = readyClient();
    client.loadRange(loadCommand());

    client.dispose();

    expect(worker.postMessage).toHaveBeenCalledWith({
      type: "range.cancel",
      correlation,
      reason: "unmounted",
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
