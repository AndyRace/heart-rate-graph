# Validation Report: On-Demand Readings

**Date**: 2026-09-12

## Release Status

Automated implementation and release gates pass for SC-001 through SC-009. The user-reported usability study passed SC-010 with 5 of 5 participants completing all four required tasks without instructions. Feature task T060 is complete.

## Automated Quality Gates

| Gate                       | Result | Evidence                                                                                                             |
| -------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| Formatting                 | PASS   | `npm run format:check`                                                                                               |
| Lint                       | PASS   | `npm run lint`                                                                                                       |
| TypeScript                 | PASS   | `npm run typecheck`                                                                                                  |
| Unit/component/integration | PASS   | `npm test`: 24 files, 139 tests                                                                                      |
| Production build           | PASS   | `npm run build`: Vite production bundle generated                                                                    |
| Browser journeys           | PASS   | `npm run test:e2e`: 155 applicable tests passed; 55 intentional project/performance skips                            |
| Accessibility              | PASS   | 30/30 targeted state tests across Chromium, Firefox, and WebKit                                                      |
| Responsive layout          | PASS   | 20/20 applicable Chromium and mobile Chrome checks at 320, 768, 1280, and 1920 CSS-pixel widths, including 200% zoom |
| Privacy                    | PASS   | Browser interception observed no source, metadata, digest, chunk, summary, or derived-reading egress                 |
| Performance                | PASS   | Opt-in production benchmark with 1,000,000 accepted readings and 20 post-warm-up samples                             |

The standard browser matrix uses one worker to avoid local CPU/storage contention destabilizing Web Worker startup. It covers desktop Chromium, Firefox, and WebKit plus emulated Pixel 7/mobile Chrome and iPhone 14/mobile Safari. Performance was measured in production-preview Chromium on this Windows development host; physical-device performance remains a release-environment follow-up.

## Million-Reading Performance

Command:

```powershell
$env:HEART_RATE_RUN_ON_DEMAND_PERF='1'
npm run test:performance
```

The generated fixture contained exactly 1,000,000 accepted readings across 100 UTC-local calendar days. Each latency scenario used two warm-ups followed by 20 measured samples.

| Scenario                      |    p50 |    p95 | Maximum |   Budget | Result |
| ----------------------------- | -----: | -----: | ------: | -------: | ------ |
| Cold prepared-history open    | 417 ms | 498 ms |  531 ms | 1,000 ms | PASS   |
| Warm prepared-history open    | 130 ms | 162 ms |  162 ms |   300 ms | PASS   |
| Uncached one-day request      | 147 ms | 180 ms |  230 ms | 1,000 ms | PASS   |
| Cached interaction            | 132 ms | 184 ms |  187 ms |   300 ms | PASS   |
| Prefetched adjacent-day reuse |  82 ms |  93 ms |   97 ms |   300 ms | PASS   |

Initial preprocessing completed in 18,017 ms. Peak reported renderer heap was 10,000,000 bytes; browser heap reporting does not include dedicated-worker and browser-process memory, so this is a regression signal rather than whole-process memory accounting. Two 20-range supersession rounds completed in 1,731 ms and 1,654 ms, with only the latest revision displayed.

## Success Criteria

| Criterion | Result                | Evidence                                                                                                                                                                                                  |
| --------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SC-001    | PASS (automated host) | Cold prepared-history p95 was 498 ms for 1,000,000 readings. Desktop and emulated-mobile functional journeys pass; physical-device timing was not measured.                                               |
| SC-002    | PASS                  | Warm p95 was 162 ms, cached interaction p95 was 184 ms, and prefetched adjacent-day p95 was 93 ms.                                                                                                        |
| SC-003    | PASS                  | The committed range immediately enters a queued/loading state; uncached one-day p95 was 180 ms and maximum was 230 ms.                                                                                    |
| SC-004    | PASS                  | Unit, integration, and browser journeys verify exact inclusive boundaries, validation totals, duplicate semantics, summaries, tables, details, and chart agreement across narrow and broad ranges.        |
| SC-005    | PASS                  | Automated 20-range supersession scenarios display only the latest correlated revision.                                                                                                                    |
| SC-006    | PASS                  | Cache/read-ahead integration tests verify reuse without duplicate repository reads; prefetched reuse p95 was 93 ms.                                                                                       |
| SC-007    | PASS                  | Automated tests cover IndexedDB unavailability, LRU exhaustion/eviction, checksum corruption, source replacement, generation invalidation, and direct recovery without changing accepted values.          |
| SC-008    | PASS                  | Privacy interception observed zero transmission of source bytes, filenames, metadata, digests, chunks, summaries, or derived health values during import, reopen, replacement, and clear.                 |
| SC-009    | PASS                  | Keyboard and axe coverage passes for indexing, loading, partial, complete, empty, cancelled, failed, session-only, replacement, and clear states across Chromium, Firefox, and WebKit.                    |
| SC-010    | PASS                  | On 2026-09-12, 5 of 5 participants reportedly completed all four required tasks without instructions; no confusion was observed. Participant profiles and study device/browser details were not recorded. |

## Integrity And Performance Notes

Active-generation opening validates generation and manifest metadata without scanning every stored chunk. Publication verifies the complete generation before the active pointer changes, and each selected chunk is checksum-validated before decoding, caching, or display. This preserves corruption detection while keeping one-day retrieval proportional to selected chunks rather than total history.

Fast multi-chunk requests proceed directly to a complete snapshot. A partial snapshot is emitted only after loading has lasted at least 50 ms, preserving truthful progress for perceptible work without forcing redundant derivation and rendering for cache-fast requests.

A startup authority race was fixed so a late `index.unavailable` response from retained-index discovery cannot clear a session import started afterward. The regression test passes, and the session-only reload journey passed 25/25 repeated cross-profile runs before the final browser matrix.

## Usability Evidence

On 2026-09-12, five participants attempted these tasks without instructions:

1. Identify whether today has readings.
2. Zoom or navigate to another interval.
3. Recognize that readings are loading dynamically.
4. Return to today.

All five participants reportedly completed all four tasks, exceeding the required 4-of-5 outcome, and no confusion was observed. Participant profiles and the devices/browsers used for this study were not recorded, so the study's representativeness cannot be independently audited. The automated browser/device evidence above covers desktop Chromium, Firefox, and WebKit plus emulated Pixel 7/mobile Chrome and iPhone 14/mobile Safari.
