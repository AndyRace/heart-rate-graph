# Contract: Worker Protocol

## Envelope

Every command and event uses a discriminated union and carries correlation fields appropriate to its lifecycle.

```ts
interface Correlation {
  datasetId: string;
  generationId: string;
  viewId: string;
  requestId: string;
  rangeRevision: number;
}
```

The client accepts a range event only when all correlation fields match the current active dataset, generation, mounted view, request, and committed range revision. Import events use `datasetId`, `generationId`, and `requestId` before a view exists.

## Client Commands

### `index.start`

Starts a full, cancellable preprocessing pass for one authorized file.

```ts
{
  type: "index.start";
  datasetId: string;
  generationId: string;
  requestId: string;
  file: File;
  retention: "persistent" | "session";
}
```

### `index.cancel`

```ts
{
  type: "index.cancel";
  datasetId: string;
  generationId: string;
  requestId: string;
}
```

Cancellation is cooperative. It prevents publication and leaves the previous active generation unchanged.

### `index.open-active`

Requests validation and opening of the retained active generation at application startup.

```ts
{
  type: "index.open-active";
  requestId: string;
}
```

### `index.clear`

Closes storage, removes all retained generations and cache entries, and returns an acknowledgement only after deletion completes or a structured blocked/failure response is available.

```ts
{
  type: "index.clear";
  requestId: string;
}
```

### `range.load`

```ts
{
  type: "range.load";
  correlation: Correlation;
  range: {
    startInstantNs: bigint;
    endInstantNs: bigint;
  }
  displayBudget: number;
  page: {
    offset: number;
    limit: number;
  }
}
```

This is foreground work. A newer `rangeRevision` supersedes older loads for the same view.

### `range.cancel`

```ts
{
  type: "range.cancel";
  correlation: Correlation;
  reason: "superseded" | "unmounted" | "user";
}
```

### `range.prefetch`

```ts
{
  type: "range.prefetch";
  correlation: Correlation;
  range: {
    startInstantNs: bigint;
    endInstantNs: bigint;
  }
  direction: "before" | "after";
}
```

Prefetch warms decoded chunks only. It cannot publish a selected range or summary and may be dropped silently under pressure after a terminal diagnostic event.

## Worker Events

### Index lifecycle

- `index.progress`: phase (`reading`, `sorting`, `merging`, `publishing`, `cleaning`), processed bytes/records, and totals when known.
- `index.ready`: active generation metadata and complete history extent.
- `index.cancelled`: candidate was not published; includes whether cleanup is pending.
- `index.failed`: structured error and recovery actions; previous active generation metadata when retained.
- `index.cleared`: confirms no app-controlled retained data remains.
- `index.unavailable`: no valid active generation exists.

Every ready/open response states `retention: "persistent" | "session"`; clients must not describe session generations as retained across browser sessions.

### Range lifecycle

- `range.started`: requested interval and selected chunk count.
- `range.snapshot`: exact current readings/display series/table page, coverage intervals, progress, and status `partial`, `complete`, or `empty`.
- `range.progress`: progress-only update when no new visible snapshot is needed.
- `range.cancelled`: terminal cancellation acknowledgement.
- `range.failed`: terminal structured error.
- `range.prefetched`: terminal diagnostic containing warmed chunk count and bytes; never changes visible data.

## Snapshot Invariants

A `range.snapshot` must satisfy all of the following:

1. Readings are sorted by exact instant and source order.
2. Every reading lies inside both a covered interval and the inclusive requested range.
3. Covered intervals are sorted, non-overlapping, and clipped to the requested range.
4. `complete` means the union of covered intervals spans the requested range.
5. `empty` means complete coverage with zero exact readings.
6. `summary` is non-null only for `complete`; it is null for `partial` and `empty`.
7. Display aggregates are derived only from the included exact readings and carry an explicit aggregation description.
8. Table totals and point lookup refer to the same exact reading slice.

## Error Shape

```ts
interface WorkerError {
  code:
    | "storage-unavailable"
    | "quota-exceeded"
    | "index-corrupt"
    | "format-unsupported"
    | "source-invalid"
    | "request-invalid"
    | "clear-blocked"
    | "unexpected";
  message: string;
  recoverable: boolean;
  actions: Array<"retry" | "reindex" | "use-session-storage" | "select-source" | "clear-data">;
}
```

Messages are user-safe and contain no heart-rate values or source content. Diagnostic details remain local and are not transmitted.

## Scheduling Contract

- At most one foreground range load performs storage/decode work at a time.
- A newly committed foreground load marks older loads cancelled before selecting more chunks.
- Cancellation is checked between IndexedDB reads, chunk decodes, merge batches, and aggregate batches.
- Foreground work pauses queued prefetch. In-progress prefetch yields at the next chunk boundary.
- Import publication and clear operations exclude range queries through explicit lifecycle states.
