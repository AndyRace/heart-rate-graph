# Research: On-Demand Heart Rate Readings

**Feature**: `002-on-demand-readings`  
**Date**: 2026-09-12

## Persistent Local Representation

**Decision**: Build a versioned, local-only IndexedDB index during the first complete import. Store immutable, time-ordered binary reading chunks, generation metadata, and temporary external-sort runs in separate object stores. Publish a generation only by committing its complete manifest and the active-generation pointer in one final transaction.

**Rationale**: The source is a sequential JSON document and cannot support efficient arbitrary time-range reads. IndexedDB is available to workers, persists across browser sessions, stores `ArrayBuffer` values without row-per-object overhead, and supports atomic transactions. Immutable generation data means an interrupted or failed replacement cannot corrupt the currently active history.

**Alternatives considered**:

- Re-read and scan the JSON file for every range: rejected because browser file permissions are not durable everywhere and request latency grows with total history size.
- Retain the complete compact dataset in worker memory: rejected because it does not meet the on-demand active-memory requirement and repeats preprocessing after reload.
- Store one IndexedDB object per reading: rejected because key/object/transaction overhead is high for up to 1,000,000 readings.
- Origin Private File System or SQLite/WASM: rejected for this increment because they add portability, migration, and binary/runtime complexity without a demonstrated need beyond IndexedDB.

## IndexedDB Access

**Decision**: Add `idb` 8.0.3 as the typed promise wrapper over native IndexedDB. Keep transaction bodies storage-only: prepare data before opening a transaction, enqueue all requests synchronously or through IndexedDB promises, and await `tx.done` before reporting durability.

**Rationale**: `idb` is small, typed, ISC-licensed, supports current Chromium, Firefox, and Safari engines, and makes transaction completion and upgrade handling explicit. Its API preserves native IndexedDB semantics while reducing callback and request error handling.

**Alternatives considered**:

- Raw IndexedDB: viable, but rejected because the additional callback and transaction plumbing would obscure the feature's integrity rules.
- Dexie: capable, but its larger abstraction and query layer are unnecessary for manifest-directed binary chunk reads.
- `localStorage`: rejected because it is synchronous, capacity-limited, string-only, and unsuitable for health-history indexes.

## Source Identity

**Decision**: Identify a source generation with a streaming SHA-256 digest of the exact file bytes plus file size. Record file name and `lastModified` only as non-authoritative display and fast-candidate metadata. Use `@noble/hashes` 2.4.0 and `sha256.create().update(chunk).digest()` while the parser consumes the same byte stream.

**Rationale**: File names, sizes, and modification times can collide. A content digest prevents stale indexed health data from being associated with a different source while adding no second file pass and no complete-file buffer. `@noble/hashes` is zero-dependency, MIT-licensed, ESM-compatible, supports incremental updates, and is actively maintained.

**Alternatives considered**:

- Metadata-only identity: rejected because it can return stale data after content changes.
- Native `crypto.subtle.digest`: rejected because its digest API requires the complete input buffer and therefore conflicts with bounded-memory import.
- A custom incremental SHA-256 implementation: rejected as avoidable cryptographic maintenance risk.

## Import, Sorting, and Chunking

**Decision**: Parse once and accumulate at most 65,536 accepted readings per staging run. Sort each run using the established timestamp/source-order comparator, apply validation semantics, and persist it. Merge runs with a bounded k-way merge into immutable chunks of at most 16,384 accepted readings. Deduplicate with the existing adjacent-reading rule during the merge so duplicates that cross run boundaries are classified correctly.

**Rationale**: The input is not guaranteed to be timestamp ordered. External sorting bounds working memory while retaining exact global ordering and duplicate semantics. Fixed-row chunks cap decode cost and provide predictable cache accounting; timestamp bounds in each descriptor still allow binary-search selection for arbitrary ranges.

**Alternatives considered**:

- UTC-day or local-day chunks: rejected because density varies widely, local-day boundaries depend on timezone, and DST creates irregular intervals.
- Sort all accepted readings in memory: rejected because memory scales with the full history.
- Deduplicate each staging run independently: rejected because duplicate groups may span runs.

## Reading Encoding and Precision

**Decision**: Use a versioned packed columnar chunk format containing signed 64-bit epoch nanoseconds, 64-bit BPM values, 32-bit source-table identifiers, and 32-bit source-order values. Store columns in little-endian `ArrayBuffer` sections with explicit offsets and lengths in the chunk header. Keep the display/query boundary in epoch milliseconds, but use epoch nanoseconds and source order for exact sorting, inclusive range comparisons, duplicate classification, and point identity.

**Rationale**: Google Fit timestamps and numeric values can exceed lossless JavaScript `number` precision. `BigInt64Array` and `Float64Array` preserve the existing exact-token interpretation while keeping chunks compact and transferable. A format version and explicit header allow corruption checks and future migrations.

**Alternatives considered**:

- Millisecond timestamps only: rejected because distinct source records inside one millisecond could lose ordering or identity.
- JSON objects in IndexedDB: rejected because parse and structured-clone overhead is high and numeric token fidelity is harder to audit.
- Delta/variable-length compression: deferred because it complicates random slicing and recovery before storage pressure is measured.

## Query and Coverage Model

**Decision**: Resolve every range against the active generation manifest, select intersecting chunks by timestamp bounds, decode only those chunks, and slice exact readings with binary search. A range snapshot carries explicit covered intervals and one of `loading`, `partial`, `complete`, `empty`, `cancelled`, or `failed`. Summaries become publishable only when coverage spans the entire requested inclusive interval.

**Rationale**: Coverage metadata prevents partial data from appearing complete. Manifest-directed chunk selection gives query cost proportional to intersecting chunks rather than total history. The same exact slice can drive graph aggregates, summary, table, and point lookup.

**Alternatives considered**:

- Return only a spinner followed by one final result: rejected because cached portions can be useful immediately and the specification requires partial-state feedback.
- Let each view query independently: rejected because graph, summary, and table could disagree during loading or cancellation.

## Request Supersession and Scheduling

**Decision**: Add worker commands for foreground `range.load`, `range.cancel`, and background `range.prefetch`. Correlate every response with `datasetId`, `generationId`, `viewId`, `requestId`, and `rangeRevision`. The worker services one foreground range at a time, checks cancellation between chunk reads/merge batches, and pauses or cancels prefetch when foreground work arrives.

**Rationale**: IDs protect the reducer from late messages while cooperative cancellation reduces wasted I/O and decode work. Foreground priority ensures adjacent-day preparation cannot delay direct interaction.

**Alternatives considered**:

- Promise ordering alone: rejected because worker and IndexedDB operations may finish out of order.
- Separate prefetch worker writing another cache: rejected because it increases coordination and duplicate-read risk without evidence that one worker cannot meet the budgets.

## Cache and Read-Ahead

**Decision**: Treat IndexedDB chunks as the durable index and add a worker-local, byte-weighted least-recently-used cache of decoded chunks with a 16 MiB default budget. After a foreground range completes, prefetch chunks intersecting up to one local calendar day before and after the visible interval. Do not create a second persistent range cache.

**Rationale**: Decoded chunks are the expensive reusable unit. Byte weighting is predictable across data density, and 16 MiB is conservative for mobile while holding many 16,384-row chunks. Durable data already exists in IndexedDB, so a second persistent cache would duplicate sensitive data and complicate invalidation.

**Alternatives considered**:

- Cache complete requested ranges: rejected because overlapping zoom ranges duplicate readings.
- Unbounded memory cache: rejected because browser and mobile memory pressure is unpredictable.
- Persistent pre-aggregations: deferred because exact summaries are required and aggregation policies vary by viewport.

## Today and Zoom Semantics

**Decision**: Compute today as `[local midnight, next local midnight - 1 ns]` by constructing consecutive local calendar midnights, not by adding 24 hours. Maintain the selected range independently from the source extent. Funnel pointer, touch, keyboard, and exact-field interactions through one canonical range-commit action; transient gestures may preview, but only committed ranges issue foreground loads.

**Rationale**: Consecutive local midnights handle 23-hour and 25-hour DST days. One commit path guarantees equivalent loading, supersession, and final results across input methods.

**Alternatives considered**:

- Add 24 hours to midnight: rejected because it fails across daylight-saving transitions.
- Issue a query on every pointer movement: rejected because it creates request churn and stale-result pressure.

## Storage Failure, Recovery, and Retention

**Decision**: Request persistent browser storage when available but never assume it is granted. Put durable and volatile storage behind the same narrow chunk-repository interface. If IndexedDB is unavailable or cannot hold a new source, offer an explicit session-only import whose encoded chunks stay in worker memory and are still queried on demand; explain that it will not survive closing the page. On schema mismatch, checksum failure, or missing chunk, mark the durable generation unusable, preserve any separate valid generation, remove incomplete staging data, and offer retry, replacement import, session-only import, or clear-retained-data actions. Clearing deletes the entire application database after closing worker connections.

**Rationale**: Browser storage can be evicted, denied, full, or corrupted. Generation isolation and explicit recovery preserve source trust and meet the requirement that incomplete writes never become active. Volatile encoded chunks preserve correct use of an otherwise supported source without pretending that persistence succeeded; only decoded chunks for the requested range enter the active LRU and UI state.

**Alternatives considered**:

- Silently fall back to the existing full decoded in-memory dataset: rejected because it increases memory pressure and the user would lose cross-session reuse without understanding why.
- Repair individual corrupt chunks in place: rejected because the original file may no longer be authorized and in-place mutation weakens generation immutability.

## Validation Strategy

**Decision**: Test codecs, manifest selection, DST boundaries, merge ordering, deduplication, coverage, request supersession, and LRU eviction at unit level; test IndexedDB lifecycle and interrupted commits with `fake-indexeddb` in Vitest; test worker/UI contracts in integration tests; and test cold/warm, accessibility, privacy, cache reuse, rapid ranges, and representative performance in Playwright on Chromium, Firefox, and WebKit.

**Rationale**: The highest risks are data fidelity, atomic publication, transaction behavior, and stale asynchronous results. Each risk needs deterministic evidence at the smallest useful boundary, plus browser coverage where IndexedDB scheduling differs.

**Alternatives considered**:

- Browser tests only: rejected because failure diagnosis and exhaustive boundary coverage would be slow.
- Mock all storage tests: rejected because transaction completion, upgrade blocking, quota behavior, and worker availability require real browser validation.
