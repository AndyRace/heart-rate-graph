# Contract: Range Loading and Zoom UX

## Initial View

When a valid retained or newly indexed generation becomes available, the application selects today's local calendar day. The interval starts at local midnight and ends one nanosecond before the next local midnight. It remains selected when no readings exist.

The previous full-history default is removed. Source history extent remains available for validating navigation and reset-to-history actions, but does not become the initial visible range.

## Canonical Range Commit

Pointer drag/zoom, touch gestures, keyboard controls, adjacent-day navigation, reset actions, and exact date/time fields all dispatch one canonical range-commit action containing an inclusive interval and new `rangeRevision`.

- Transient gestures may update a visual preview without querying.
- A committed interval updates the visible selection immediately.
- The prior foreground request is cancelled.
- A new foreground request is issued for the committed interval.
- A result with stale correlation fields is ignored without changing visible state.

## Visible States

| State       | Visual behavior                                                                              | Non-visual behavior                                | Data rules                                                                           |
| ----------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `loading`   | Stable chart area with progress treatment and requested range label                          | Polite status announces the range is loading       | No result is described as complete                                                   |
| `partial`   | Exact available points may appear with a clear incomplete treatment; controls remain enabled | Status announces partial availability and progress | Summary is pending; uncovered time is distinguishable                                |
| `complete`  | Graph, summary, table, and details update together                                           | Status announces completion and reading count      | All views use the same exact snapshot                                                |
| `empty`     | Empty-range message inside stable workspace; navigation remains available                    | Status announces no readings in the selected range | Coverage is complete and count is zero                                               |
| `cancelled` | Superseded requests do not flash an error; explicit user cancellation has a short status     | Cancellation is announced only when useful         | No cancelled result replaces current data                                            |
| `failed`    | Error names the affected range and offers valid recovery actions                             | Assertive status announces failure once            | Prior completed snapshot may remain visually identifiable as stale, never as current |

Loading feedback appears within 100 milliseconds of a committed uncached request. Progress uses chunk counts when total work is known and an indeterminate indicator otherwise. Animations honor reduced-motion preferences.

## Partial Coverage

Partial rendering is optional for very fast requests but mandatory when an intermediate snapshot is emitted. The UI must:

- identify the requested interval separately from covered intervals;
- avoid final summary language and final reading totals;
- retain controls and the selected range;
- replace the partial snapshot atomically when a newer snapshot for the same request arrives; and
- never combine snapshots from different generations or range revisions.

## Zoom and Navigation

- Zoom-in centers on the interaction anchor and reduces duration by a deterministic factor.
- Zoom-out centers on the current midpoint and increases duration by the reciprocal factor, clipped only to supported instant bounds.
- Keyboard zoom uses the same operation as pointer/touch zoom.
- Exact range fields are authoritative after validation and use established inclusive semantics.
- A Today command recomputes local-day boundaries at invocation time.
- Day-before/day-after navigation uses local calendar arithmetic, not fixed 24-hour durations.
- Controls retain stable dimensions and remain operable while data loads.

## Read-Ahead Feedback

Adjacent-day prefetch is intentionally quiet. It may update an unobtrusive cache diagnostic used by tests, but it must not change the selected range, steal focus, announce routine completion, or block foreground status. Prefetch failure is surfaced only when it affects a later foreground request or indicates retained storage needs recovery.

## Replacement Import

A replacement import has a distinct indexing state and progress phase. The current active generation and selected range stay usable until the replacement publishes successfully. Cancellation or failure restores the existing workspace without a source switch. Successful publication switches generation identity, selects today for the new source, and prevents old snapshots from being accepted.

## Session-Only Recovery

When persistent storage is unavailable or full, the error state may offer **Use for this session**. Before indexing begins, supporting text explains that processing still requires one complete pass and that the index disappears after refresh or tab closure. The active workspace shows a concise session-only status and continues to use the same today-first, range-loading, integrity, and clear-data behavior.

## Clear Retained Data

The control is labeled explicitly and requires confirmation that names local indexed heart-rate data. During deletion, import and range actions are disabled. Success returns to the no-source state. Blocked or failed deletion keeps the state truthful and provides retry guidance.

## Accessibility and Responsive Requirements

- All zoom, pan/navigation, today, range, cancel, retry, re-index, and clear actions are keyboard operable with visible focus.
- The chart retains a synchronized non-visual table for exact values.
- Status uses an appropriate live region without announcing every progress increment; announce phase changes and meaningful percentage thresholds.
- Color is not the only distinction among partial, complete, empty, and failed states.
- At supported mobile and desktop widths and browser zoom levels, status text and controls do not overlap or resize the graph unexpectedly.
- Pointer and touch gestures have equivalent button or field controls.

## Acceptance Observability

Automated tests may inspect local diagnostic counters exposed only in development/test builds:

- selected and decoded chunk IDs;
- memory-cache hit/miss and eviction counts;
- foreground and prefetch request IDs;
- cancellation checkpoints; and
- source generation ID.

Diagnostics must contain no heart-rate values and must not create network traffic.
