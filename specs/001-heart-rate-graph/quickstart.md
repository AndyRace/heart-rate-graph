# Quickstart and Validation Guide

## Prerequisites

- Node.js 22 LTS and npm 10 or later
- Current Chrome, Firefox, and WebKit browser binaries installed through Playwright
- A private local copy of the supplied Google Fit export for contract and performance validation

The private health-data fixture MUST remain ignored by Git. Automated tests use generated and small
synthetic fixtures from `tests/fixtures/`.

## Setup

After implementation creates `package.json`:

```powershell
npm ci
npx playwright install
```

## Quality Gates

Run the narrow checks while developing, then all gates before review:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run build
npm run test:e2e
npm run test:performance
```

The scripts are required deliverables of implementation. Tests MUST not send network requests
containing fixture contents.

## Local Run

```powershell
npm run dev
```

Open the URL printed by Vite on a supported desktop or mobile browser. Verify the startup capability
check completes before selecting a file.

## Scenario 1: Valid Import and Exact Data

1. Select a synthetic valid fixture matching
   [the input contract](contracts/google-fit-heart-rate-json.md).
2. Confirm the full time span appears and each detailed reading has a marker.
3. Compare point details, table rows, minimum, maximum, mean, and count with fixture values.
4. Confirm line segments break only when consecutive readings are more than 30 minutes apart.
5. Confirm the browser network log contains no upload of the file or reading data.

Expected: source values and instants match exactly; connecting lines never create table rows or affect
summaries.

## Scenario 2: Range Synchronization

1. Drag a range on desktop and perform the equivalent touch gesture in a mobile viewport.
2. Confirm both date/time fields, chart selection, summary, table, and announcement show one range.
3. Enter exact valid boundaries and apply them using only the keyboard.
4. Select a nested range, then reset.

Expected: every input path updates the canonical range once, stale responses never flash, and reset
restores the complete source range.

## Scenario 3: Validation and Replacement Safety

1. Import fixtures containing missing, malformed, out-of-range, duplicate, and equal-time distinct
   readings.
2. Confirm counts by category and exact accepted readings against the input contract.
3. With valid data visible, attempt replacement with malformed JSON and then cancel another import.

Expected: bad records are never invented or silently corrected, and failed/cancelled replacements do
not change the existing graph or range.

## Scenario 4: Accessibility and Responsive Layout

1. Complete import, range selection through fields, exact reading inspection, pagination, and reset
   using only the keyboard.
2. Run automated axe checks in each application state.
3. Inspect at 320, 768, 1280, and 1920 CSS pixels and at 200% browser zoom.
4. Verify live announcements and semantic table behavior with a screen reader manually.

Expected: no critical automated violations, visible focus throughout, no overlap or lost function,
and all essential chart information available without canvas perception.

## Scenario 5: Million-Record Performance

1. Generate a deterministic one-million-record fixture outside version control.
2. Run import on the named representative desktop and mobile devices.
3. Record import duration, peak memory, cancellation behavior, and range-query latency.
4. Repeat with the private supplied fixture to validate its exact schema and realistic distribution.

Expected: 95% of measured imports show a usable graph within 10 seconds; 95% of range interactions
show visible feedback within 500 milliseconds; memory failure is graceful and retains prior data.

## Contract References

- [Data model](data-model.md)
- [Google Fit JSON contract](contracts/google-fit-heart-rate-json.md)
- [Worker protocol](contracts/worker-protocol.md)
- [UI behavior](contracts/ui-behavior.md)
