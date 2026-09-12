# Implementation Plan: On-Demand Heart Rate Readings

**Branch**: `002-on-demand-readings` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-on-demand-readings/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Replace the worker's complete in-memory history with a persistent, local, generation-based index that opens at today's local calendar day and decodes only chunks intersecting the committed visible range. A first import streams and hashes the source, writes bounded sorted runs, externally merges them into immutable packed chunks, and atomically publishes a manifest. Foreground range requests supersede stale work, expose truthful coverage states, use a 16 MiB decoded-chunk LRU, and schedule lower-priority adjacent-day read-ahead after completion.

## Technical Context

**Language/Version**: TypeScript 6.0.3, React 19.3, browser Web Workers, Node.js 22.18 for tooling

**Primary Dependencies**: Vite 8.3, uPlot 1.6.32, `@streamparser/json` 0.0.26, `idb` 8.0.3, `@noble/hashes` 2.4.0

**Storage**: IndexedDB generation manifests and packed `ArrayBuffer` chunks; session-only encoded chunk repository when persistent storage is unavailable; worker-local 16 MiB decoded LRU

**Testing**: Vitest 5, React Testing Library, `fake-indexeddb`, Playwright 1.55, axe

**Target Platform**: Modern Chromium, Firefox, and WebKit desktop/mobile-class browsers; local-only/offline operation

**Project Type**: Single-page web application with a dedicated data worker

**Performance Goals**: Prepared today view at most 1 second p95; cached range actions at most 300 milliseconds p95; uncached one-day loads at most 1 second p95; loading feedback within 100 milliseconds

**Constraints**: Preserve exact accepted values, epoch-nanosecond ordering, source identity, duplicate/validation semantics, and inclusive ranges; no health-data network transmission; bounded import/query memory; atomic replacement; WCAG 2.2 AA; no partial result represented as complete

**Scale/Scope**: One active source and one candidate replacement; up to 1,000,000 accepted readings; arbitrary inclusive ranges from sub-hour detail to full history; one foreground query and up to two adjacent local-day prefetch windows

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### Pre-Research Gate

| Principle                 | Evidence                                                                                                                                                                         | Result |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| I. Maintainable Code      | Storage, codecs, indexing, query scheduling, and UI state are separate focused modules behind typed contracts. Added dependencies are small, maintained, and license-compatible. | PASS   |
| II. Tests Define Behavior | Plan requires unit, IndexedDB integration, worker contract, browser journey, accessibility, privacy, corruption, and performance tests.                                          | PASS   |
| III. Health Data Trust    | Exact values/timestamps/source order remain in immutable chunks; summaries require complete coverage; generation publication is atomic; all processing stays local.              | PASS   |
| IV. Consistent UX         | One canonical range commit and one snapshot feed graph, summary, details, and table across every state and input method.                                                         | PASS   |
| V. Ease and Accessibility | Controls remain usable during loads; every state has visible and live-region feedback; chart values remain available in the table.                                               | PASS   |
| Product constraints       | Format, timezone, malformed data, volume, persistence, recovery, and measurable p95 budgets are specified.                                                                       | PASS   |

No constitution violations or unresolved clarifications remain.

## Project Structure

### Documentation (this feature)

```text
specs/002-on-demand-readings/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/
│   ├── range-loading-ux.md
│   ├── storage-schema.md
│   └── worker-protocol.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── App.tsx                         # Startup reopen, source lifecycle, range orchestration
│   ├── app-reducer.ts                  # Explicit index/range/retention states
│   └── browser-capabilities.ts          # IndexedDB and persistence capability reporting
├── domain/
│   ├── readings.ts                     # Exact reading/domain types
│   ├── summary.ts                      # Complete exact-range summaries
│   └── time-range.ts                   # Inclusive bounds, local today, canonical zoom
├── features/
│   ├── accessible-data/                # Snapshot-backed exact table
│   ├── chart/                          # Snapshot-backed graph and gestures
│   ├── import/                         # Index progress, retention choice, clear controls
│   └── range/                          # Loading/coverage feedback and range controls
├── shared/
│   └── worker-messages.ts              # Protocol discriminated unions
└── worker/
  ├── import-worker.ts                # Command router and foreground scheduler
  ├── parser-adapter.ts               # Streaming parse plus source hashing feed
  ├── external-sort.ts                # Bounded staging runs and k-way merge
  ├── chunk-codec.ts                  # Versioned packed binary encoding
  ├── chunk-manifest.ts               # Manifest validation and range selection
  ├── chunk-repository.ts             # Persistent/volatile repository contract
  ├── indexeddb-repository.ts         # Atomic durable generations
  ├── volatile-repository.ts          # Explicit session-only recovery
  ├── chunk-lru.ts                    # Byte-weighted decoded cache
  ├── queries.ts                      # Chunk-sliced exact and aggregate queries
  └── worker-client.ts                # Lifecycle and stale-message filtering

tests/
├── unit/
│   ├── chunk-codec.test.ts
│   ├── chunk-manifest.test.ts
│   ├── chunk-lru.test.ts
│   └── time-range.test.ts
├── integration/
│   ├── index-repository.test.ts
│   ├── index-worker.test.ts
│   ├── on-demand-range.test.ts
│   └── replacement-import.test.ts
├── e2e/
│   └── on-demand-readings.spec.ts
└── performance/
  └── on-demand-performance.spec.ts
```

**Structure Decision**: Extend the existing single Vite application and dedicated worker. Keep persistent storage and binary mechanics inside `src/worker`; keep exact range/time rules in `src/domain`; expose only typed lifecycle snapshots to the existing feature components. No backend or network service is introduced.

## Architecture and Data Flow

### Startup

1. Start the worker and open IndexedDB through the typed repository.
2. Validate the active pointer, generation, manifest, descriptors, and supported format.
3. If valid, return source metadata/history extent and select today's local range.
4. Issue one foreground range load; decode only intersecting chunks.
5. If no valid generation exists, show source selection and recovery state.

### First Import or Replacement

1. Create an isolated candidate generation; never alter the active pointer.
2. Feed each file byte chunk to incremental SHA-256 and the established streaming parser.
3. Validate records and flush sorted runs after at most 65,536 accepted readings.
4. K-way merge runs by exact epoch nanoseconds and source order, applying duplicate semantics across run boundaries.
5. Encode at most 16,384 rows per immutable chunk and write each chunk in a bounded transaction.
6. Validate final counts/checksums, then commit manifest, `ready` status, and active pointer atomically.
7. Select today for the published generation; remove obsolete/staging data in interruptible batches.

Cancellation or failure before step 6 discards the candidate and leaves the prior source visible. The volatile repository follows the same lifecycle but lasts only for the worker session.

### Foreground Range Query

1. Canonical range commit increments `rangeRevision`, cancels prior work, and enters `loading` immediately.
2. The worker selects intersecting descriptors from the active manifest.
3. For each descriptor, use a generation-scoped decoded LRU hit or read, checksum, and decode the chunk.
4. Binary-search boundary chunks, merge exact slices, and optionally emit coverage-aware partial snapshots.
5. Only after complete coverage, calculate exact summary/table totals and emit `complete` or `empty`.
6. The reducer accepts the message only if every correlation field still matches.
7. After foreground completion, enqueue preceding/following local-day chunks for low-priority read-ahead.

### Compatibility and Migration

This is an index format introduction, not an in-place migration of the existing in-memory dataset. Existing users have no durable feature-001 index; they select the source once and complete the new preprocessing pass. Future schema or binary changes must either perform an explicitly tested migration or invalidate the generation and request re-indexing. Unsupported bytes are never guessed or partially decoded.

## Delivery Strategy

1. Establish exact timestamp/chunk codecs, manifest selection, repository contract, and tests.
2. Add IndexedDB and volatile repositories with atomic publication, cleanup, corruption, quota, and blocked-upgrade tests.
3. Replace full-memory compaction with staged external sort and chunk emission while preserving parser validation and cancellation.
4. Implement chunk-backed exact range queries, coverage, summary gating, decoded LRU, and foreground scheduling.
5. Extend worker protocol/client/reducer with generation and request correlation; switch startup/import to today-first loading.
6. Unify zoom/navigation commit paths, add truthful state feedback, adjacent-day read-ahead, persistence/clear UX, and accessibility coverage.
7. Run cross-browser correctness, privacy, responsive, cold/warm performance, and release evidence from [quickstart.md](quickstart.md).

## Post-Design Constitution Check

| Principle                 | Design evidence                                                                                                                                                                                 | Result |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| I. Maintainable Code      | One repository boundary supports durable and explicit fallback storage; binary format and protocol are versioned contracts; modules follow existing worker/domain/UI ownership.                 | PASS   |
| II. Tests Define Behavior | [quickstart.md](quickstart.md) maps unit, integration, browser, accessibility, privacy, and p95 checks to critical behavior and failures.                                                       | PASS   |
| III. Health Data Trust    | [storage-schema.md](contracts/storage-schema.md) requires checksums and atomic publication; [worker-protocol.md](contracts/worker-protocol.md) forbids complete summaries before full coverage. | PASS   |
| IV. Consistent UX         | [range-loading-ux.md](contracts/range-loading-ux.md) defines one commit path and all loading outcomes for every view and input method.                                                          | PASS   |
| V. Ease and Accessibility | Range controls stay operable; status announcements are bounded; exact data remains non-visually available; session retention is disclosed.                                                      | PASS   |
| Product constraints       | Local-only processing, exact input semantics, DST, one-million-reading scale, recovery, and measurable budgets are covered.                                                                     | PASS   |

Design remains constitution-compliant with no required exceptions.

## Complexity Tracking

No violations require justification.
