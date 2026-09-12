# Quickstart: Validate On-Demand Heart Rate Readings

## Prerequisites

- Node.js 22.18.0 or later in the supported Node 22 line
- npm 10.9.3 or later
- Current Chromium, Firefox, and WebKit browsers installed through Playwright
- Local fixtures only; do not add private Google Fit exports to the repository

## Install and Baseline

```powershell
npm ci
npx playwright install
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: all static checks, unit/integration tests, and the production build pass before browser scenarios begin.

## Focused Automated Validation

Run the storage, worker, range, and date-boundary tests introduced by this feature:

```powershell
npx vitest run tests/unit/chunk-codec.test.ts tests/unit/chunk-manifest.test.ts tests/unit/chunk-lru.test.ts tests/unit/time-range.test.ts
npx vitest run tests/integration/index-repository.test.ts tests/integration/index-worker.test.ts tests/integration/on-demand-range.test.ts tests/integration/replacement-import.test.ts
```

Expected:

- Chunk round trips preserve exact epoch nanoseconds, BPM values, source IDs, and source order.
- External merge output matches the established full-sort and duplicate behavior, including duplicates split across staging runs.
- An interrupted publication never changes the active generation.
- Missing or corrupt chunks invalidate the generation instead of returning partial data as complete.
- A newer range revision cancels or supersedes every older revision.
- Today uses consecutive local midnights across ordinary, 23-hour, and 25-hour days.
- LRU accounting never evicts pinned foreground chunks and returns to its 16 MiB budget after use.

## First Import and Today

1. Start the application:

   ```powershell
   npm run dev
   ```

2. Open the displayed local URL.
3. Select a deterministic large fixture spanning multiple months.
4. Observe the `reading`, `sorting`, `merging`, and `publishing` progress phases.
5. During a separate run, cancel in each phase and reload the page.
6. Complete the import.

Expected:

- Cancellation never exposes a candidate generation, and any prior active history remains usable.
- Successful publication selects today's local calendar day rather than the full source extent.
- Graph, exact table, point details, and summary agree for today.
- If today has no readings, today remains selected and the complete empty state is shown.
- Reloading reopens the retained generation without selecting the source file again.

## Dynamic Range Loading

1. Zoom into one hour using pointer or touch.
2. Repeat the same interval using keyboard controls and exact date/time fields.
3. Zoom out across several days.
4. Commit 20 different ranges rapidly, ending on a known interval.

Expected:

- Each input method commits identical inclusive bounds.
- Loading feedback appears promptly and names the requested range.
- Any partial snapshot identifies incomplete coverage and withholds the final summary.
- Only the final revision can publish the completed graph, summary, table, and point details.
- Broad ranges decode only intersecting chunks and keep complete source history out of React state.

## Cache and Read-Ahead

1. Complete a one-day foreground request.
2. Wait for idle read-ahead.
3. Navigate to the preceding day, following day, and original day.
4. Inspect development/test diagnostics for selected chunk IDs and cache hits.

Expected:

- Foreground completion schedules at most one local day in each direction.
- Prepared chunks are reused without duplicate source parsing.
- A foreground request pauses or cancels lower-priority prefetch.
- Eviction affects speed only; re-reading the durable chunk returns identical values.

## Storage Failure and Recovery

Exercise quota denial or IndexedDB failure through the test harness, then choose **Use for this session**.

Expected:

- The application explains that the index will disappear after refresh or tab closure.
- The complete preprocessing pass and on-demand range semantics remain correct.
- Only requested chunks are decoded into the active cache and view.
- Refreshing loses the volatile generation without damaging any separate durable generation.

Corrupt one test chunk or remove it, then reopen the application.

Expected: the generation is not queried, the issue is reported without exposing health values, and re-index/select-source/clear recovery actions are available.

## Replacement and Clear

1. Keep one retained history active and begin importing a replacement.
2. Cancel or fail the replacement, then repeat and let it complete.
3. Activate **Clear retained data** and confirm.

Expected:

- Failed or cancelled replacement keeps the prior generation, range, and cached values.
- Successful replacement atomically switches generation and selects today.
- Old-generation messages cannot update the new workspace.
- Clear removes persistent and volatile app data and returns to no-source state; a reload cannot reopen it.

## Accessibility, Responsive, and Privacy

```powershell
npm run test:e2e
```

Run representative desktop and mobile projects with browser zoom and reduced motion enabled where configured.

Expected:

- Loading, partial, complete, empty, cancelled, and failed states have equivalent non-visual status and no critical axe violations.
- All range actions are keyboard operable with visible focus; touch/pointer actions have equivalent controls.
- Status and controls do not overlap or resize the chart incoherently.
- Network assertions observe no source bytes, metadata, digest, readings, chunks, summaries, or derived health data leaving the application.

## Performance Evidence

```powershell
npm run test:performance
```

Collect at least 20 measured iterations after warm-up on representative desktop and mobile projects and report p95 values.

Expected for a prepared history of up to 1,000,000 accepted readings:

- Today's usable view: at most 1 second p95.
- Prepared/cached zoom, pan, reset, and adjacent-day result: at most 300 milliseconds p95.
- Uncached one-day result: at most 1 second p95.
- Loading feedback after an uncached commit: at most 100 milliseconds.

Record device/browser, fixture seed and size, cold/warm state, sample count, p50, p95, and failures. Keep generated fixtures synthetic and deterministic.
