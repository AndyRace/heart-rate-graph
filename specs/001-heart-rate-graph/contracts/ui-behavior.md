# Contract: User Interface Behavior

## Application States

| State               | Required presentation and actions                                                          |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Initial             | File selection, privacy statement, supported-input text, medical disclaimer                |
| Importing           | File name, determinate progress when byte length is known, processed count, cancel action  |
| Ready               | Chart, synchronized range fields, reset, summary, data-quality report, exact-reading table |
| Partial data        | Ready UI plus accepted/excluded counts grouped by reason                                   |
| Empty range         | Selected boundaries, zero-reading summary, visible empty message, reset/edit controls      |
| Replacement failed  | Existing chart remains; error explains why replacement was not applied                     |
| Fatal import failed | No new chart; error and retry/file-selection action                                        |
| Unsupported browser | Missing capability list and no import attempt                                              |

Status changes use a polite live region. Fatal errors receive focus without trapping it.

## Range Contract

1. The canonical range is an inclusive pair of absolute instants.
2. Desktop pointer drag and mobile touch drag create a preview, then commit on release.
3. Start/end `datetime-local` fields display the same instants as local wall time.
4. Valid field edits commit on explicit Apply or Enter, update the chart selection, summary, and table,
   and announce the new boundaries.
5. Invalid, reversed, nonexistent local, or out-of-dataset values show field-level errors and do not
   mutate the committed range.
6. Ambiguous daylight-saving local times require the user to choose the displayed offset before
   commit.
7. Nested selection is allowed. Reset restores the complete dataset range in one action.
8. Results tagged with an earlier range revision are ignored.

## Chart Contract

- X-axis is local date/time; Y-axis is beats per minute.
- Exact mode shows a marker for each source reading and connecting line segments.
- A line breaks when consecutive exact readings are more than 30 minutes apart.
- Connecting lines are visual guides and never appear in exact-reading output.
- Aggregated mode is visibly labelled and preserves first, last, minimum, and maximum source readings
  per bucket; it does not draw synthetic averages.
- Pointer/touch inspection identifies the nearest exact reading and displays bpm, local date/time,
  timezone offset, and source when present.
- Resizing requests a new pixel-bounded series without changing the canonical range.

## Accessible Data Contract

- The chart has a concise name and description of the current range and aggregation mode.
- Native labeled fields and buttons provide keyboard parity for every chart range action.
- The summary exposes minimum, maximum, arithmetic mean, exact count, and duration as text.
- A semantic table provides exact readings in pages of 25, 50, or 100 rows.
- Previous/next-reading controls permit exact reading inspection without pointer movement.
- Focus remains on the initiating control after normal updates; reset and import completion are
  announced without forced focus movement.
- All interactive controls have visible focus and meet WCAG 2.2 AA contrast.

## Responsive Contract

- At 320 pixels, controls stack without horizontal page scrolling; the chart retains a stable minimum
  height and the table can scroll within its own labelled region.
- Wider layouts may place range controls and summaries beside the graph, but DOM reading order remains
  logical.
- At 200% browser zoom, no control, status, summary, or essential graph label overlaps or disappears.
- Touch targets are at least 24 by 24 CSS pixels, with larger spacing where adjacent actions could be
  confused.

## Privacy and Safety Copy

The initial and importing states state that processing occurs on this device and data is not uploaded
or retained after the session. Every ready/error state keeps an informational-only, not-medical-advice
statement available without presenting it as an alarm.
