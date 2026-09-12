# Phase 0 Research: Interactive Heart Rate Graph

## Static Browser Architecture

**Decision**: Build a static React 19 application in strict TypeScript 6 with Vite 8. Use no backend,
router, database, account system, or persistent browser storage.

**Rationale**: The feature is one local workflow. A static app keeps private health data on the
device, works on desktop and mobile browsers, and avoids server and deployment complexity. React is
well suited to synchronized controls, explicit loading/error states, accessible tables, and testable
state transitions. Vite supports module workers directly.

**Alternatives considered**:

- Vanilla TypeScript reduces runtime dependencies but adds manual lifecycle and state synchronization.
- Svelte is viable but does not simplify the worker, parser, aggregation, or accessibility risks.
- A server-backed application contradicts local-only processing and adds no required capability.

## Streaming Import and Worker Isolation

**Decision**: Send the selected `File` to a dedicated module worker and parse `File.stream()` with
`@streamparser/json-whatwg` 0.x behind a project-owned adapter. Select items under the top-level
`Data Points` array and stage replacement imports in a new worker.

**Rationale**: The supplied export is very large. `file.text()` plus `JSON.parse()` would hold the
file bytes, a UTF-16 string, the parsed object graph, and normalized readings at once. Streaming
limits transient memory, while a worker prevents parsing and sorting from blocking interaction. A
staging worker allows failed replacement imports to leave the current dataset untouched.

**Alternatives considered**:

- Whole-file parsing in a worker protects the UI thread but still risks memory exhaustion.
- A custom scanner is rejected because JSON escaping, Unicode, nesting, and chunk boundaries are
  security and correctness hazards.
- `SharedArrayBuffer` requires cross-origin isolation and is unnecessary for the first release.

## Input Mapping and Timestamp Precision

**Decision**: Support the observed Google Fit shape documented in
[contracts/google-fit-heart-rate-json.md](contracts/google-fit-heart-rate-json.md). Read bpm from
`fitValue[0].value.fpVal`, preserve `originDataSourceId`, and parse `startTimeNanos` and
`endTimeNanos` from their token text with `BigInt` before converting to epoch milliseconds.

**Rationale**: Observed nanosecond values exceed JavaScript's exact integer range. Conversion through
`number` can silently change the represented instant. Contract tests against a private copy of the
supplied fixture and small committed fixtures protect the parser adapter from package changes.

**Alternatives considered**:

- Treating JSON numeric timestamps as ordinary numbers is rejected due to precision loss.
- Using `modifiedTimeMillis` as the measurement time is incorrect; it describes record modification.
- Supporting multiple Google Fit schemas is outside the clarified scope.

## Compact Store, Ordering, and Duplicates

**Decision**: Store normalized timestamps and bpm values in `Float64Array`, and interned source
identifiers in the smallest sufficient unsigned typed array. Sort chronologically when input
is not ordered, then classify adjacent identical tuples as duplicates. Query ranges with binary
search.

**Rationale**: Typed arrays avoid the per-object overhead of one million JavaScript objects. Sorting
makes range lookup deterministic and permits duplicate removal without a million-entry hash set.
Identity includes timestamp, bpm, and source metadata, so different values at the same instant remain
distinct.

**Alternatives considered**:

- Keeping readings as React objects is memory-heavy and causes avoidable copying.
- A global duplicate set uses substantial additional memory.
- Persisting data in IndexedDB violates session-only retention for this feature.

## Display Aggregation and Charting

**Decision**: Render with uPlot 1.x through a small project-owned React adapter. Query at most four
representative values per chart CSS pixel. Broad-range buckets preserve first, last, minimum, and
maximum source readings; detailed ranges return exact readings and markers. Insert line gaps whenever
consecutive readings are more than 30 minutes apart.

**Rationale**: uPlot is focused on dense time series and accepts array-based data without requiring
large object graphs. Pixel-bounded min/max output protects responsiveness without hiding spikes.
Summaries always use exact worker-owned readings, never display aggregates.

**Alternatives considered**:

- Apache ECharts has broader built-in interaction but a larger surface and less control over copying.
- Chart.js is approachable but less suitable for million-point dense series.
- D3 provides primitives but would require implementing most chart behavior and lifecycle code.

## UI State and Range Synchronization

**Decision**: Use React `useReducer` plus Context for small UI state. Keep the dataset exclusively in
the worker. Brush, touch, and date/time inputs dispatch one canonical range action with a monotonically
increasing request identifier; stale worker responses are ignored.

**Rationale**: A single canonical range prevents graph and fields from drifting apart. Explicit
states cover empty, importing, ready, partial data, replacement failure, cancellation, and unsupported
browser behavior without adding a state-management dependency.

**Alternatives considered**:

- Redux Toolkit and Zustand add dependencies without solving worker ownership.
- Letting chart and form controls own separate ranges risks loops and inconsistent summaries.

## Accessibility and Responsive Interaction

**Decision**: Treat canvas as a visual projection, not the accessible data model. Provide labeled
date/time controls, a reset action, visible summaries, polite status announcements, and a paginated
semantic table of exact readings. Test keyboard operation, touch input, 320-to-1920-pixel layouts,
200% browser zoom, and WCAG 2.2 AA contrast.

**Rationale**: Canvas pixels do not expose the information needed by screen readers. Native controls
and semantic DOM provide precise equivalents without creating one million DOM nodes.

**Alternatives considered**:

- ARIA on each plotted point is unusable at this scale.
- A generated chart description alone cannot provide exact reading access.

## Browser and Dependency Policy

**Decision**: Support current and previous major Chrome, Edge, Firefox, Safari, and iOS Safari, plus
current Android Chrome. Require workers, `Blob.stream()`, typed arrays, `BigInt`, canvas, and pointer
or touch events. Pin the 0.x streaming parser exactly; use supported stable major lines for other
dependencies and commit the lockfile.

**Rationale**: These capabilities avoid heavy polyfills and are necessary for bounded-memory import.
A startup capability check provides a clear failure before the user selects private data.

**Alternatives considered**:

- Legacy browser support would add polyfills that do not address memory and worker limitations.
- Exact pinning every mature dependency blocks routine patches; major-line control plus a lockfile is
  sufficient, while the pre-1.0 parser receives stricter treatment.

## Verification Strategy

**Decision**: Use Vitest 5 for domain and worker tests, React Testing Library for semantic component
tests, Playwright 1.x for browser journeys, and `@axe-core/playwright` 4.x for automated accessibility
checks. Generate the million-record performance fixture during tests rather than committing it.

**Rationale**: This layering tests calculations cheaply, validates stream chunk boundaries and worker
lifecycles, and verifies real file upload, pointer/touch, keyboard, responsive, and accessibility
behavior in supported browser engines.

**Alternatives considered**:

- End-to-end-only coverage would be slow and weak at algorithm boundaries.
- Unit-only coverage cannot validate browser file, worker, canvas, or interaction behavior.

## Risks and Mitigations

- Mobile memory limits vary. Stream input, cap accepted records at 1,000,000, bound display output,
  expose cancellation, and fail without replacing the prior dataset.
- The 10-second import target depends on representative hardware. Record named desktop and mobile
  devices with performance results and treat regressions as release blockers.
- Browser tab suspension can terminate an import. Report interruption and require re-import; do not
  persist health data to work around it.
- The source fixture is not in the current working tree. Restore a private ignored copy for parser
  contract and performance validation before release.
