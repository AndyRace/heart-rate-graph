# Feature Specification: Interactive Heart Rate Graph

**Feature Branch**: `001-heart-rate-graph`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "Graph heart-rate data downloaded from Google Fit. Data is in JSON. Display must be an interactive graphical app allowing the user to drill down into a time band."

## Clarifications

### Session 2026-09-12

- Q: What Google Fit input package must the first release accept? → A: One heart-rate JSON file matching the supplied export.
- Q: How must users select an exact time band for drill-down? → A: Drag across the graph plus synchronized start and end date/time fields.
- Q: Which device types must the first release support? → A: Desktop and mobile browsers.
- Q: How should individual heart-rate readings be represented when the graph is detailed enough to show them? → A: Connect readings with a line and show source markers.
- Q: When should the connecting line break across a period with no readings? → A: Break when readings are more than 30 minutes apart.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Import and View Heart Rate History (Priority: P1)

As a person with a Google Fit JSON export, I want to load my heart-rate history and see it as a
time-based graph so that I can understand how my readings changed over time.

**Why this priority**: Importing and accurately displaying the source data is the minimum useful
product and the foundation for all further interaction.

**Independent Test**: Load a valid representative Google Fit heart-rate JSON file and verify that
the graph covers the full source time span, displays beats per minute against time, and provides the
same essential values in a non-visual form.

**Acceptance Scenarios**:

1. **Given** no data is loaded, **When** the user selects a valid Google Fit heart-rate JSON file,
   **Then** the application displays all valid readings across the full available time range.
2. **Given** a graph is displayed, **When** the user points to, focuses, or otherwise selects a data
   point, **Then** the application shows its exact heart rate and local date and time.
3. **Given** valid data is loaded, **When** the user accesses the non-visual data view, **Then** the
   essential timestamps, values, and displayed summary are available without relying on the graph.
4. **Given** the visible range is detailed enough to show individual readings, **When** the graph is
   rendered, **Then** each source reading has a visible marker and consecutive readings are connected
   by line segments that do not create additional readings.
5. **Given** two chronologically consecutive readings are more than 30 minutes apart, **When** the
   graph is rendered, **Then** no line segment connects those readings.

---

### User Story 2 - Drill Down into a Time Band (Priority: P2)

As a user viewing a long heart-rate history, I want to select a time band and inspect it in greater
detail so that dense readings become understandable without losing my place in the overall history.

**Why this priority**: Time-band exploration is the defining interactive capability, but it depends
on a trustworthy full-range graph.

**Independent Test**: Starting from the full-range graph, select a smaller interval, verify that the
detail view shows only that interval at increased temporal resolution, and restore the full range.

**Acceptance Scenarios**:

1. **Given** the full-range graph is displayed on a desktop or mobile browser, **When** the user
   drags or uses the equivalent touch gesture across the graph to select a start and end time,
   **Then** the display drills down to that interval and updates the start and end date/time fields
   to the same boundaries.
2. **Given** a drilled-down interval is displayed, **When** the user selects a narrower interval,
   **Then** the graph drills down again without changing or discarding the source data.
3. **Given** any drilled-down interval, **When** the user chooses to reset the view, **Then** the
   full source time range is restored in one action.
4. **Given** a graph is displayed, **When** the user enters valid start and end values in the
   date/time fields, **Then** the graph drills down to those exact boundaries and updates its visual
   selection to match.
5. **Given** the time-range controls have keyboard focus, **When** the user operates them using only
   a keyboard, **Then** the same drill-down and reset outcomes are available.

---

### User Story 3 - Understand Data Quality and Summaries (Priority: P3)

As a user, I want clear summary values and warnings for problematic records so that I can interpret
the graph without mistaking omitted or aggregated data for original measurements.

**Why this priority**: Summaries and data-quality feedback improve confidence after core viewing and
drill-down work, while protecting the meaning of health data.

**Independent Test**: Load data containing valid, duplicate, malformed, and out-of-range records;
verify that valid data is summarized, excluded records are reported, and no replacement values are
invented.

**Acceptance Scenarios**:

1. **Given** a displayed interval with valid readings, **When** the graph finishes updating, **Then**
   the application displays the interval's minimum, maximum, average, reading count, and duration.
2. **Given** a file containing unusable records, **When** import completes, **Then** the application
   reports the number and reason for excluded records while graphing the remaining valid readings.
3. **Given** a file with no usable heart-rate readings, **When** import completes, **Then** the
   application displays a clear error and retains the previous valid view, if one exists.

### Edge Cases

- The selected file is empty, unreadable, not valid JSON, or does not contain recognizable
  heart-rate records.
- Records contain missing timestamps or values, non-numeric values, impossible timestamps, or heart
  rates outside the accepted range of 1 to 300 beats per minute.
- Records are duplicated, appear out of chronological order, or share a timestamp with differing
  values; duplicates are identified by matching timestamp, value, and source metadata, while
  differing readings at the same timestamp remain distinct.
- The data spans daylight-saving changes or multiple recorded timezone offsets; each instant remains
  unchanged and is displayed in the user's current local timezone with its offset available.
- The selected time band contains no readings or only one reading.
- Chronologically consecutive readings more than 30 minutes apart are displayed as separate line
  segments so the graph does not imply continuous coverage across the gap.
- The source contains enough points that drawing every reading would make the graph unresponsive or
  visually misleading; any reduced display indicates that aggregation is active while exact source
  readings remain available on further drill-down.
- A second file is selected after a valid file; replacement occurs only after the new file has been
  validated successfully.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The application MUST allow the user to select and import one heart-rate JSON file that
  matches the supplied Google Fit export's schema. Multiple-file selection, folders, archives, and
  alternate export schemas are not supported.
- **FR-002**: The application MUST process the selected file locally and MUST NOT transmit or retain
  its contents outside the user's active session.
- **FR-003**: The application MUST recognize heart-rate readings with a numeric beats-per-minute
  value and a timestamp that identifies a unique instant.
- **FR-004**: The application MUST preserve every accepted reading's original value, instant, and
  available source metadata without interpolation or silent correction.
- **FR-005**: The application MUST validate imported records and report counts grouped by accepted,
  duplicate, missing, malformed, and out-of-range status.
- **FR-006**: The application MUST display accepted readings on a time-based graph with clearly
  labelled time and beats-per-minute axes. When individual readings are visible, each reading MUST
  have a source marker and chronologically consecutive readings MUST be connected by line segments.
  The line MUST break when consecutive readings are more than 30 minutes apart. Connecting segments
  MUST NOT be treated or reported as interpolated measurements.
- **FR-007**: The application MUST initially display the complete time span of the imported data.
- **FR-008**: The user MUST be able to select a contiguous time band by dragging across the graph,
  using the equivalent touch gesture, or entering exact start and end values in date/time fields.
  The graph selection and fields MUST remain synchronized, and each method MUST set the graph's new
  visible range.
- **FR-009**: The application MUST support repeated drill-down into nested time bands and MUST provide
  a single action that restores the full range.
- **FR-010**: The application MUST display the exact start and end of the current visible range and
  MUST provide exact timestamp and heart-rate details for an individually selected reading.
- **FR-011**: For the visible range, the application MUST display minimum, maximum, arithmetic mean,
  reading count, and elapsed duration calculated from accepted source readings.
- **FR-012**: If readings are grouped to keep a dense graph usable, the application MUST identify the
  displayed aggregation and MUST preserve minimum and maximum values so spikes are not hidden.
- **FR-013**: The application MUST distinguish initial, loading, success, empty-range, partial-data,
  and failed-import states and provide a clear recovery action for every error state.
- **FR-014**: A failed replacement import MUST NOT remove the last successfully loaded data or the
  user's current view.
- **FR-015**: All graph exploration and import controls MUST be operable by keyboard, have visible
  focus, and expose meaningful accessible names.
- **FR-016**: The application MUST provide a non-visual presentation of essential readings, current
  time range, summaries, and data-quality messages.
- **FR-017**: All primary journeys MUST work in desktop and mobile browsers. User-facing graph
  content and controls MUST remain usable without overlap or loss of function at viewport widths
  from 320 to 1920 pixels and at 200% browser zoom.
- **FR-018**: The application MUST state that the visualization is informational and does not provide
  medical advice or diagnosis.

### Key Entities _(include if feature involves data)_

- **Import Session**: One user-selected source file during the active application session; includes
  file identity, import status, record counts by validation outcome, and the overall valid time span.
- **Heart Rate Reading**: One accepted source measurement; includes its unique instant, numeric value
  in beats per minute, and available source metadata. Readings with identical instant, value, and
  source metadata are duplicates; readings that differ in any of those fields remain distinct.
- **Time Band**: A contiguous inclusive interval selected by the user; includes start and end instants
  and is constrained to the imported data's valid time span.
- **Visible Summary**: Derived facts for accepted readings inside the current time band; includes
  minimum, maximum, arithmetic mean, count, duration, and any active aggregation disclosure.
- **Validation Result**: The classification and reason assigned to an imported record without
  modifying the source record.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: At least 95% of first-time users can import a valid file, view the complete graph, drill
  into a chosen time band, and restore the full range without instructions or assistance.
- **SC-002**: For a representative file containing up to 1,000,000 records, 95% of imports show a
  usable full-range graph within 10 seconds on supported desktop and mobile devices.
- **SC-003**: After import, 95% of drill-down, reset, point-detail, and range-summary updates provide
  visible feedback within 500 milliseconds.
- **SC-004**: For validation fixtures, 100% of displayed exact readings and summary values match the
  accepted source records, including data crossing timezone and daylight-saving boundaries.
- **SC-005**: Automated accessibility checks report no critical violations, and all primary journeys
  can be completed using only a keyboard and the non-visual data presentation.
- **SC-006**: At viewport widths from 320 to 1920 pixels and 200% browser zoom, all primary journeys
  remain completable with no overlapping controls or loss of essential graph information.
- **SC-007**: In a moderated usability check with at least five representative users, at least four
  correctly identify the current time range, an exact reading, and the minimum and maximum values
  without assistance.

## Assumptions

- The first release serves a single user examining their own exported data and requires no accounts,
  sharing, collaboration, editing, or cloud synchronization.
- The supplied Google Fit export is the authoritative input schema and reference fixture. Support
  for alternate Google Fit schemas, unrelated health-data formats, and direct connection to Google
  services is outside this feature.
- Heart-rate values use beats per minute. Values from 1 through 300 are accepted; values outside that
  range are reported as out of range and excluded without replacement.
- Source timestamps represent absolute instants. The graph displays them in the user's current local
  timezone while preserving the original instant and any available source offset.
- The first release supports current desktop and mobile browsers with local file access. Desktop
  browsers provide keyboard input and browser zoom; mobile browsers provide touch interaction and
  platform text scaling.
- The visualization is informational only; diagnosis, alerts, treatment recommendations, and medical
  device claims are outside scope.
