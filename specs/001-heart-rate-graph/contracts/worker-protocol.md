# Contract: Import and Query Worker Protocol

## Boundary Rules

- The worker owns complete datasets and parser state.
- Every command includes `requestId`; dataset commands also include `datasetId`.
- The UI ignores responses whose `requestId`, `datasetId`, or range revision is stale.
- Messages return only status, summaries, or bounded windows. Full datasets are never cloned to React.
- Numeric result buffers are transferred, not copied.

## UI-to-Worker Commands

### `import.start`

```text
{ type, requestId, sessionId, file, acceptedRecordLimit: 1000000 }
```

Starts a staging import. The worker first validates capabilities and top-level shape, then streams,
validates, sorts, deduplicates, and indexes records.

### `import.cancel`

```text
{ type, requestId, sessionId }
```

Stops parsing and releases all staging buffers. It cannot remove the active dataset.

### `range.query`

```text
{ type, requestId, datasetId, revision, startMs, endMs, chartWidthCssPx }
```

Returns one exact or aggregated Display Series and one exact Visible Summary. Output contains no more
than four representative values per chart CSS pixel plus required gap separators.

### `reading.page`

```text
{ type, requestId, datasetId, revision, startMs, endMs, page, pageSize }
```

Returns exact readings for the semantic table. Supported page sizes are 25, 50, and 100.

### `reading.nearest`

```text
{ type, requestId, datasetId, revision, instantMs, direction }
```

Returns the nearest exact reading in the visible range for pointer inspection or DOM previous/next
controls. Direction is `nearest`, `previous`, or `next`.

### `dataset.dispose`

```text
{ type, requestId, datasetId }
```

Releases a dataset after a successful replacement is committed or the page closes.

## Worker-to-UI Events

### `import.progress`

```text
{ type, requestId, sessionId, bytesRead, totalBytes, processedRecords, provisionalCounts }
```

Emitted at most four times per second and at phase transitions.

### `import.ready`

```text
{ type, requestId, sessionId, datasetId, counts, fullRange, sourceNames }
```

Signals that staged data is valid and indexed. The UI atomically commits this dataset, then disposes
the prior one. `sourceNames` contains bounded display-safe identifiers, not source records.

### `import.failed`

```text
{ type, requestId, sessionId, code, message, counts? }
```

Codes: `unsupported-browser`, `invalid-json`, `unsupported-schema`, `no-valid-readings`,
`record-limit`, `memory-limit`, `read-failed`, and `worker-failed`. Messages are user-safe and contain
no source values.

### `import.cancelled`

```text
{ type, requestId, sessionId }
```

### `range.result`

```text
{ type, requestId, datasetId, revision, series, summary }
```

The series owns transferred buffers. Its mode and bucket duration are always explicit.

### `reading.page.result` and `reading.nearest.result`

Return bounded exact-reading results tagged with dataset and revision.

### `request.failed`

```text
{ type, requestId, datasetId?, code, message }
```

Used for invalid ranges, stale/disposed datasets, invalid pages, and unexpected query failures.

## Replacement Import Sequence

```text
UI retains active dataset
  -> start staging worker/import
  -> progress events
  -> import.ready
  -> UI switches active dataset atomically
  -> UI disposes old dataset
```

On failure or cancellation, the staging data is released and the active dataset and current Time Band
remain unchanged.

## Error and Logging Policy

Operational logs MAY include event type, duration, counts, capability results, and error code. They
MUST NOT include filenames by default, JSON fragments, timestamps from readings, bpm values, or source
metadata. Production builds do not enable verbose worker tracing.
