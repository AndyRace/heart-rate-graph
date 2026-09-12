# Feature Specification: On-Demand Heart Rate Readings

**Feature Branch**: `002-on-demand-readings`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "Update data handling to read readings on demand. Start with today and load only today's readings. Allow zooming in and out with feedback while readings load dynamically. Cache where possible, read ahead by a day before and after, or process the JSON into a more retrievable local data store."

## User Scenarios & Testing

### User Story 1 - Open Today's Readings Quickly (Priority: P1)

As a person reviewing a large heart-rate history, I want the graph to open at today and retrieve only the readings needed for that day so that I can begin reviewing recent data without loading the complete history into the active view.

**Why this priority**: A fast, useful initial view is the main reason to change the current all-at-once data flow.

**Independent Test**: Open an indexed history containing readings across many months and verify that the initial graph requests and displays only the current local calendar day, while preserving exact readings and showing a clear empty state when today has no readings.

**Acceptance Scenarios**:

1. **Given** an available heart-rate history, **When** the user opens the graph, **Then** the selected range is today's local calendar day and only readings required for that range are made available to the graph, summary, and table.
2. **Given** today contains readings, **When** the initial request completes, **Then** the graph, summary, exact-reading details, and non-visual table agree on the same readings and time boundaries.
3. **Given** today contains no readings, **When** the initial request completes, **Then** the application keeps today selected, explains that no readings exist in the range, and offers navigation or zoom controls without silently substituting another day.
4. **Given** today's readings are still being retrieved, **When** the user views the workspace, **Then** the application shows non-blocking progress or loading feedback while retaining usable range controls.
5. **Given** a newly selected source has no valid local index, **When** the user starts the import, **Then** the application completes one full indexing pass with progress and cancellation before presenting today's complete readings.

---

### User Story 2 - Zoom Through History On Demand (Priority: P2)

As a user exploring heart-rate history, I want zooming or panning to retrieve the newly visible interval dynamically so that I can move between detailed and broad views without waiting for the entire history to be loaded first.

**Why this priority**: Dynamic range retrieval is the core interaction needed to keep large histories responsive after the today-first view.

**Independent Test**: Starting from today, zoom into an hour, zoom out across several days, and move to an uncached interval; verify that each committed range receives visible feedback and eventually displays the exact data and summary for that range.

**Acceptance Scenarios**:

1. **Given** today's range is displayed, **When** the user zooms into a smaller interval, **Then** the application retrieves any missing readings for that interval and updates the graph, summary, and table together.
2. **Given** a detailed interval is displayed, **When** the user zooms out beyond currently available readings, **Then** the application requests the missing portion, indicates that data is loading, and does not present incomplete data as complete.
3. **Given** a range request is in progress, **When** the user changes the range again, **Then** stale results do not replace the newer selection and the latest range remains authoritative.
4. **Given** some requested readings are already cached, **When** the range changes, **Then** cached readings appear without unnecessary reprocessing while missing portions continue loading with a visible partial or loading state.
5. **Given** a pointer, touch, keyboard, or date/time-field range action, **When** it commits the same interval, **Then** every input method produces the same loading and final display behavior.

---

### User Story 3 - Revisit Nearby Ranges Efficiently (Priority: P3)

As a user moving around a period of interest, I want nearby days and previously viewed ranges prepared for reuse so that common back-and-forth exploration feels immediate.

**Why this priority**: Read-ahead and reuse improve repeated exploration after correct on-demand retrieval is established.

**Independent Test**: Display one day, wait for background preparation, then move to the preceding and following days and revisit the original day; verify that prepared data is reused and that background work never changes the selected range.

**Acceptance Scenarios**:

1. **Given** a day is displayed, **When** foreground loading is complete and capacity is available, **Then** the application prepares up to one local calendar day before and one day after the visible interval.
2. **Given** a prepared adjacent day, **When** the user navigates into it, **Then** the application reuses the prepared readings and avoids duplicate source processing.
3. **Given** limited storage or memory, **When** read-ahead cannot be retained, **Then** visible-range data takes priority and the application continues correctly without read-ahead.
4. **Given** the source file changes or a replacement import succeeds, **When** cached data no longer matches the active source, **Then** stale cached readings and summaries are not displayed.
5. **Given** a valid local index exists, **When** the user returns in a later browser session, **Then** the application can reuse it until the user explicitly clears retained data or the source is invalidated.

### Edge Cases

- The local calendar day crosses a daylight-saving transition and is not exactly 24 hours long.
- Today is partly complete and new source data is not automatically available after the file was selected.
- A zoomed range spans cached and uncached intervals or contains no readings.
- The user changes ranges repeatedly while earlier requests and read-ahead work are still running.
- The requested interval is larger than the cache capacity or the source contains more than 1,000,000 accepted readings.
- Local storage is unavailable, full, cleared, or denied.
- The source file is moved, renamed, modified, or replaced after an index or cache was created.
- Background read-ahead fails while the visible range succeeds.
- A malformed or interrupted preprocessing operation leaves an incomplete index.

## Requirements

### Functional Requirements

- **FR-001**: The application MUST select the current local calendar day as the initial visible range for an available history.
- **FR-002**: The application MUST retrieve readings according to the current visible range rather than placing the complete history in the active graph, summary, table, or interface state.
- **FR-003**: The graph, exact-reading table, point details, and summary MUST use one inclusive visible range and MUST agree on which accepted source readings it contains.
- **FR-004**: The application MUST visibly distinguish loading, partially available, complete, empty, cancelled, and failed range states.
- **FR-005**: Loading feedback MUST identify the range being loaded and MUST not imply that a partial result is complete.
- **FR-006**: The user MUST be able to zoom in and out through pointer, touch, keyboard, and exact date/time controls while retaining the established accessibility and responsive behavior.
- **FR-007**: A committed range change MUST supersede prior range requests; late or cancelled results MUST NOT overwrite the current range.
- **FR-008**: The application MUST reuse exact readings already available for a requested range and retrieve only missing intervals where practical.
- **FR-009**: After the visible range is complete, the application SHOULD prepare up to one local calendar day before and one local calendar day after that range when doing so does not delay foreground work.
- **FR-010**: Visible-range loading and user actions MUST take priority over background preparation, which MUST be cancellable or deferrable.
- **FR-011**: Cache entries MUST be associated with the exact source version and covered time interval so stale readings cannot be returned after a source change.
- **FR-012**: Cached or indexed data MUST preserve exact accepted values, absolute instants, source identity, duplicate classification, validation counts, and ordering; display aggregation MUST remain separate from source readings.
- **FR-013**: Summaries MUST be calculated from exact accepted readings in the selected range, never from display aggregates or incomplete data represented as complete.
- **FR-014**: The application MUST remain local-only and MUST NOT transmit source files, indexes, cached readings, or derived health information.
- **FR-015**: The application MUST operate correctly when caching is unavailable or full, with a clear recovery path and no loss or corruption of the source file.
- **FR-016**: Incomplete preprocessing or cache writes MUST be discarded or recoverable and MUST NOT be treated as a valid source index.
- **FR-017**: A failed or cancelled replacement source MUST retain the prior active source, selected range, and valid cached data.
- **FR-018**: The application MUST support a retrievable local representation of the source history when direct on-demand access to the original JSON cannot meet the performance outcomes.
- **FR-019**: Cached or indexed health data MUST remain available on the local device across browser sessions until the user explicitly clears it or source invalidation makes it stale.
- **FR-020**: On first use of an unindexed JSON file, the application MUST complete one full, cancellable preprocessing pass before presenting today's readings as complete.
- **FR-021**: The existing accepted range of 1 through 300 beats per minute, exact timestamp rules, validation categories, privacy statement, and informational-only disclaimer MUST remain unchanged.
- **FR-022**: The user MUST be able to clear any retained local index or cache and return to a state with no retained health data.

### Key Entities

- **Source Version**: The identity of one selected source file version, including enough non-content attributes to invalidate derived data when the file changes without exposing its health values.
- **Reading Segment**: An exact, ordered set of accepted readings covering a known time interval, with completeness and source-version status.
- **Range Request**: One request for an inclusive visible interval, including its revision, priority, progress, and terminal outcome.
- **Cache Entry**: Reusable local data for a source version and time interval, with completeness, recency, and size information.
- **Read-Ahead Window**: Lower-priority preparation for the local day before or after the current visible interval.
- **Source Index**: A complete, atomic lookup representation that maps time intervals to exact source readings and validation information.

## Success Criteria

### Measurable Outcomes

- **SC-001**: For an already prepared history containing up to 1,000,000 accepted readings, today's graph becomes usable within 1 second for at least 95% of measured openings on representative supported desktop and mobile devices.
- **SC-002**: For cached or prepared intervals, 95% of zoom, pan, reset, and adjacent-day actions provide the complete visible result within 300 milliseconds.
- **SC-003**: For uncached intervals, visible loading feedback appears within 100 milliseconds of a committed range change, and 95% of one-day requests complete within 1 second on representative supported devices.
- **SC-004**: At every tested zoom level, 100% of exact readings, validation categories, and completed summary values match the accepted source records for the selected interval.
- **SC-005**: Rapidly committing 20 different ranges never displays a completed result belonging to an earlier range after the latest selection.
- **SC-006**: Navigating to a successfully prepared preceding or following day avoids duplicate source processing in 100% of automated read-ahead tests.
- **SC-007**: Cache unavailability, exhaustion, corruption, or invalidation never prevents direct retrieval of an otherwise supported source and never changes source values.
- **SC-008**: Automated privacy checks observe zero transmission of source, cached, indexed, or derived health data.
- **SC-009**: All loading and range actions remain keyboard operable and expose equivalent non-visual status, with no critical accessibility violations across loading, partial, complete, empty, and failure states.
- **SC-010**: At least 4 of 5 representative users can identify today's status, zoom to another interval, recognize that readings are loading, and return to today without instructions.

## Assumptions

- "Today" means midnight through the end of the current calendar day in the browser's current local timezone, including daylight-saving transitions.
- Today remains selected when it has no readings; the product does not silently jump to the most recent reading.
- The user explicitly selects or reauthorizes access to the source file where browser security requires it.
- Read-ahead is an optimization, not a prerequisite for correctness, and may be skipped under resource pressure.
- The product continues to support one active source history and one staged replacement at a time.
- Retained indexes and cached readings remain local to the device and persist across browser sessions until explicitly cleared or invalidated.
- A first-time import may require a complete preprocessing pass; progress and cancellation remain available, and no partial result is represented as complete.
- Choosing a database, file index, browser storage mechanism, or in-memory cache is a planning decision; this specification defines observable retrieval, integrity, privacy, and recovery behavior.
