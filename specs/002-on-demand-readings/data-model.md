# Data Model: On-Demand Heart Rate Readings

**Feature**: `002-on-demand-readings`  
**Date**: 2026-09-12

## Overview

The model separates immutable persistent source generations from transient range requests and decoded-memory cache entries. Only one complete generation is active. Staging records are never queryable through the active manifest.

## Source Generation

Represents one completely indexed version of a selected Google Fit JSON file.

| Field              | Type                          | Rules                                                       |
| ------------------ | ----------------------------- | ----------------------------------------------------------- |
| `generationId`     | UUID string                   | Primary identity; generated before indexing starts          |
| `sourceDigest`     | lowercase hex string          | SHA-256 of exact source bytes; required before publication  |
| `fileName`         | string                        | Display metadata only; not identity                         |
| `fileSize`         | non-negative integer          | Exact byte length                                           |
| `lastModified`     | non-negative integer          | Display/fast-candidate metadata only                        |
| `formatVersion`    | positive integer              | Must equal a supported index format                         |
| `retention`        | `persistent` or `session`     | Session generations are never advertised as durable         |
| `status`           | generation state              | Only `ready` can become active                              |
| `startedAt`        | epoch milliseconds            | Indexing start time                                         |
| `completedAt`      | epoch milliseconds or null    | Set only after all chunks and manifest metadata are durable |
| `acceptedCount`    | non-negative integer          | Sum of accepted readings in chunks                          |
| `duplicateCount`   | non-negative integer          | Count produced by the existing duplicate rule               |
| `validationCounts` | validation count map          | Preserves every established validation category             |
| `minimumInstantNs` | signed 64-bit integer or null | Null when there are no accepted readings                    |
| `maximumInstantNs` | signed 64-bit integer or null | Null when there are no accepted readings                    |
| `chunkCount`       | non-negative integer          | Must equal the number of manifest descriptors               |

**Relationships**:

- Owns zero or more reading chunks and staging runs.
- Has exactly one manifest when `ready`.
- Is referenced by the singleton active-generation pointer only after publication.

**Validation**:

- A generation cannot transition to `ready` until its source digest, final counts, and every chunk descriptor are known.
- Aggregate counts and bounds must agree with the chunk descriptors.
- Unsupported format versions are invalidated and require re-indexing.

**State transitions**:

```text
indexing -> finalizing -> ready
indexing -> cancelled
indexing -> failed
finalizing -> failed
ready -> invalid
ready -> deleting
cancelled|failed|invalid|deleting -> deleted
```

## Active Generation Pointer

A singleton control record identifying the only generation visible to queries.

| Field          | Type                        | Rules                                                     |
| -------------- | --------------------------- | --------------------------------------------------------- |
| `key`          | literal `active-generation` | Singleton primary key                                     |
| `generationId` | UUID string                 | Must reference a `ready` generation                       |
| `publishedAt`  | epoch milliseconds          | Set in the same transaction as final manifest publication |

Replacing the pointer does not immediately delete the previous generation. Cleanup occurs after publication and must not make the new pointer visible before its data is durable.

## Generation Manifest

The immutable query map for a complete source generation.

| Field              | Type                     | Rules                                            |
| ------------------ | ------------------------ | ------------------------------------------------ |
| `generationId`     | UUID string              | Primary key; matches owning generation           |
| `formatVersion`    | positive integer         | Governs descriptor and binary decoding           |
| `chunks`           | ordered descriptor array | Sorted by `(minimumInstantNs, firstSourceOrder)` |
| `acceptedCount`    | non-negative integer     | Sum of descriptor row counts                     |
| `validationCounts` | validation count map     | Exact import totals                              |
| `checksum`         | hex string               | Digest of canonical manifest metadata            |

Descriptors include `chunkId`, row count, byte length, minimum/maximum epoch nanoseconds, first/last source order, and payload checksum. Empty generations have an empty descriptor array.

## Reading Chunk

An immutable packed set of globally ordered accepted readings.

| Field              | Type                     | Rules                          |
| ------------------ | ------------------------ | ------------------------------ |
| `generationId`     | UUID string              | Part of compound primary key   |
| `chunkId`          | non-negative integer     | Sequential within a generation |
| `rowCount`         | integer from 1 to 16,384 | Final chunk may be smaller     |
| `minimumInstantNs` | signed 64-bit integer    | Equal to first row timestamp   |
| `maximumInstantNs` | signed 64-bit integer    | Equal to last row timestamp    |
| `byteLength`       | non-negative integer     | Must equal payload size        |
| `checksum`         | hex string               | Detects payload corruption     |
| `payload`          | `ArrayBuffer`            | Versioned packed columnar data |

Each decoded row contains:

- `instantNs`: exact signed 64-bit epoch nanoseconds.
- `bpm`: exact finite numeric value accepted by the existing 1 through 300 rule.
- `sourceId`: index into the generation source table.
- `sourceOrder`: original accepted-record order used as a stable tie-breaker.

Ordering is ascending by exact instant and then source order. Duplicate classification is preserved separately from display aggregation.

## Staging Run

A temporary sorted run created during bounded-memory import.

| Field              | Type                     | Rules                                         |
| ------------------ | ------------------------ | --------------------------------------------- |
| `generationId`     | UUID string              | Owning candidate generation                   |
| `runId`            | non-negative integer     | Sequential within generation                  |
| `rowCount`         | integer from 1 to 65,536 | Last run may be smaller                       |
| `minimumInstantNs` | signed 64-bit integer    | Selection and merge metadata                  |
| `maximumInstantNs` | signed 64-bit integer    | Selection and merge metadata                  |
| `payload`          | `ArrayBuffer`            | Staging codec; never exposed to range queries |

Runs may be removed as merge output becomes durable. Every run for cancelled, failed, or abandoned generations is garbage-collection eligible.

## Range Request

A transient request for one inclusive visible interval.

| Field              | Type                         | Rules                                         |
| ------------------ | ---------------------------- | --------------------------------------------- |
| `requestId`        | UUID/string counter          | Unique within worker client lifetime          |
| `datasetId`        | string                       | Identifies the UI's selected source lifecycle |
| `generationId`     | UUID string                  | Must match active generation at dispatch      |
| `viewId`           | string                       | Identifies the mounted consuming view         |
| `rangeRevision`    | increasing integer           | Latest committed range wins                   |
| `startInstantNs`   | signed 64-bit integer        | Inclusive and not greater than end            |
| `endInstantNs`     | signed 64-bit integer        | Inclusive                                     |
| `priority`         | `foreground` or `background` | Foreground always wins                        |
| `status`           | range state                  | Drives visible and accessible status          |
| `coveredIntervals` | ordered interval array       | Non-overlapping, clipped to request           |
| `loadedChunkCount` | non-negative integer         | Progress numerator                            |
| `totalChunkCount`  | non-negative integer         | Progress denominator when known               |
| `error`            | structured error or null     | Present only for `failed`                     |

**State transitions**:

```text
queued -> loading -> partial -> complete
queued -> loading -> complete
queued -> loading -> empty
queued|loading|partial -> cancelled
queued|loading|partial -> failed
```

A `complete` or `empty` result requires full interval coverage. `partial` may expose exact readings for covered intervals but cannot expose a completed summary.

## Range Snapshot

The single coherent result consumed by graph, summary, table, and point details.

| Field              | Type                        | Rules                                                          |
| ------------------ | --------------------------- | -------------------------------------------------------------- |
| Correlation fields | copied from range request   | All must match the current selection before reducer acceptance |
| `requestedRange`   | inclusive interval          | Exact committed interval                                       |
| `coveredIntervals` | interval array              | Union indicates currently proven coverage                      |
| `readings`         | exact ordered reading slice | Only accepted source readings in covered intervals             |
| `displaySeries`    | aggregate series            | Derived from readings; never replaces them                     |
| `summary`          | exact summary or null       | Null until request is complete; null for empty                 |
| `status`           | range state                 | Must agree with coverage and readings                          |
| `progress`         | progress object             | Chunk and optional byte counts                                 |

## Decoded Chunk Cache Entry

A transient worker-local representation of one durable reading chunk.

| Field                | Type                          | Rules                                           |
| -------------------- | ----------------------------- | ----------------------------------------------- |
| `key`                | generation/chunk compound key | Prevents cross-generation reuse                 |
| `decodedColumns`     | typed arrays                  | Exact decoded payload                           |
| `byteWeight`         | non-negative integer          | Sum of retained buffer sizes and fixed overhead |
| `lastAccessSequence` | increasing integer            | LRU ordering                                    |
| `pinCount`           | non-negative integer          | Active foreground reads cannot be evicted       |

The cache has a 16 MiB default budget. Unpinned least-recently-used entries are evicted until the budget is met. Oversized single entries may be used for the active request and released afterward.

## Chunk Repository

A narrow worker-owned boundary used by indexing and queries.

| Operation                          | Contract                                                       |
| ---------------------------------- | -------------------------------------------------------------- |
| `createGeneration`                 | Creates an isolated candidate in persistent or session storage |
| `putStagingRun` / `readStagingRun` | Stores and streams bounded merge inputs                        |
| `putChunk` / `readChunk`           | Stores or retrieves encoded immutable chunks                   |
| `publishGeneration`                | Atomically exposes a complete candidate within repository life |
| `getActiveManifest`                | Returns only a complete, validated generation                  |
| `discardGeneration`                | Removes candidate data without changing another active source  |
| `clear`                            | Removes all data controlled by that repository                 |

The IndexedDB implementation survives browser sessions. The volatile implementation retains encoded runs and chunks in worker memory only, reports `retention: session`, and uses the same generation publication and query invariants. It is a storage-failure recovery mode, not the default cache.

## Read-Ahead Window

A background range request derived from a completed visible range.

| Field                 | Type                     | Rules                                        |
| --------------------- | ------------------------ | -------------------------------------------- |
| `direction`           | `before` or `after`      | One request per direction                    |
| `localDayRange`       | inclusive interval       | Calculated from consecutive local midnights  |
| `parentRangeRevision` | integer                  | Invalid when the foreground revision changes |
| `status`              | background request state | Never changes selected UI range              |

Read-ahead can be skipped, paused, cancelled, or evicted without affecting foreground correctness.
