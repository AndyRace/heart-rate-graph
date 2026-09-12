# Validation Report: Interactive Heart Rate Graph

**Date**: 2026-09-12

## Automated Quality Gates

| Gate                       | Result | Evidence                                                                                                                                                           |
| -------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Formatting                 | PASS   | `npm run format:check`                                                                                                                                             |
| Lint                       | PASS   | `npm run lint`                                                                                                                                                     |
| TypeScript                 | PASS   | `npm run typecheck`                                                                                                                                                |
| Unit/component/integration | PASS   | 14 files, 29 tests                                                                                                                                                 |
| Production build           | PASS   | Vite production bundle generated                                                                                                                                   |
| Browser journeys           | PASS   | 49 applicable tests across Chromium, Firefox, WebKit, mobile Chrome, and mobile Safari projects; 56 intentional project-specific/performance/private-fixture skips |
| Automated accessibility    | PASS   | No serious or critical axe findings in initial, importing, ready, partial, empty-range, fatal-error, or replacement-error states                                   |
| Responsive layout          | PASS   | 320, 768, 1280, and 1920 CSS-pixel scenarios plus 200% zoom checks                                                                                                 |
| Privacy                    | PASS   | Browser interception found no request containing the synthetic filename, source identifier, timestamp token, bpm value, or JSON payload                            |

## Million-Record Performance

The deterministic generated fixture contains 1,000,000 valid records and omits optional source metadata. It is generated under the ignored `tests/performance/generated/` directory.

| Profile                |   Import | Peak measured JS heap | Range update | Replacement cancellation | Result |
| ---------------------- | -------: | --------------------: | -----------: | -----------------------: | ------ |
| Desktop Chromium       | 9,083 ms |      11,900,000 bytes |       321 ms |                   448 ms | PASS   |
| Emulated mobile Chrome | 9,241 ms |      11,900,000 bytes |       305 ms |                   461 ms | PASS   |

The import budget is 10,000 ms, the interaction budget is 500 ms, and cancellation budgets are 1,000 ms desktop and 1,500 ms mobile. Browser heap reporting measures the renderer heap and does not include dedicated-worker memory, so it is retained as a regression signal rather than a whole-process measurement.

## Private Supplied Export

The ignored supplied export was exercised through the production worker path without logging filenames, timestamps, bpm values, source identifiers, or JSON fragments.

| Property                                   | Result                                                          |
| ------------------------------------------ | --------------------------------------------------------------- |
| File size                                  | 1,121,579,632 bytes                                             |
| Schema                                     | Recognized as the supported Google Fit `Data Points` shape      |
| Outcome                                    | Expected `record-limit` rejection at accepted reading 1,000,001 |
| Last throttled processed-count observation | 982,101 records                                                 |
| Duration to safe rejection                 | 13,324 ms                                                       |
| Peak measured renderer JS heap             | 11,900,000 bytes                                                |
| Data replacement                           | No prior dataset would be replaced on this failure path         |

The source export exceeds the product limit of 1,000,000 accepted readings. The parser therefore rejects it instead of truncating or silently dropping accepted readings. The displayed progress count is intentionally throttled and is not the rejection count.

## Scenario Coverage

- Valid import, exact graph/table values, point inspection, line gaps, and local-only processing: automated PASS.
- Pointer, touch, field, nested-range, keyboard, and reset synchronization: automated PASS.
- Validation categories, exact summaries, failed replacement retention, and cancellation retention: automated PASS.
- Initial/importing/ready/partial/empty/error accessibility states and responsive layouts: automated PASS.
- Million-record generated fixture and private supplied export: automated PASS within the documented product limits.

## Manual Evidence Pending

The following release evidence requires human access to physical hardware and assistive technology and has not been claimed as complete:

- Screen-reader journey with product/version and browser/version recorded.
- Physical iOS Safari journey with device, OS, and browser versions recorded.
- Physical Android Chrome journey with device, OS, and browser versions recorded.
- Moderated first-time usability check required by SC-001 and SC-007.

Until those checks are performed, tasks T056 and T058 remain open and the release should not be represented as having completed every manual quality gate.
