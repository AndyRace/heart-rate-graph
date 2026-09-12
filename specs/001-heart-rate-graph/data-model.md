# Data Model: Interactive Heart Rate Graph

## Invariants

- Source measurements and derived display values are separate types.
- All internal timestamps are epoch milliseconds representing absolute instants.
- Nanosecond source tokens are converted with integer arithmetic before entering numeric storage.
- Summaries use accepted exact readings, never chart buckets.
- The worker owns all complete-dataset arrays; UI messages contain bounded result windows only.
- One active import can remain visible while one replacement import is staged.

## Import Session

Represents one selected file and its lifecycle.

| Field              | Type                     | Rules                                           |
| ------------------ | ------------------------ | ----------------------------------------------- |
| `sessionId`        | string                   | Unique within the page lifetime                 |
| `fileName`         | string                   | Display only; never transmitted                 |
| `fileSizeBytes`    | non-negative integer     | Captured before import                          |
| `status`           | Import Status            | Controls allowed transitions                    |
| `processedRecords` | non-negative integer     | Monotonically increases during import           |
| `counts`           | Validation Counts        | Sum equals processed records after parsing      |
| `datasetId`        | string or absent         | Present only after successful commit            |
| `failure`          | Import Failure or absent | Present for failed/cancelled/unsupported states |

### Import Status Transitions

```text
empty -> capability-check -> importing -> validating -> indexing -> ready
                                  |            |           |
                                  +------------+-----------+-> failed
                                  +---------------------------> cancelled

ready -> replacement-importing -> ready (commit replacement)
                              \-> replacement-failed (retain active dataset)
                              \-> ready (cancel replacement)
```

## Raw Google Fit Record

An ephemeral parser-adapter value emitted from one `Data Points` item.

| Field                 | Source                    | Requirement                                      |
| --------------------- | ------------------------- | ------------------------------------------------ |
| `dataTypeName`        | record string             | Must equal `com.google.heart_rate.bpm`           |
| `startTimeNanosToken` | raw JSON token            | Required integer token                           |
| `endTimeNanosToken`   | raw JSON token            | Required integer token                           |
| `bpmCandidate`        | `fitValue[0].value.fpVal` | Required finite number                           |
| `originDataSourceId`  | record string             | Preserved when present; empty sentinel otherwise |
| `modifiedTimeMillis`  | record value              | Preserved as optional metadata when valid        |
| `rawTimestampNanos`   | record value              | Preserved as optional metadata when valid        |

This value is discarded after validation and normalization.

## Heart Rate Reading

An accepted exact source measurement.

| Field          | Storage                      | Rules                                                                     |
| -------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `instantMs`    | `Float64Array`               | Derived from `startTimeNanos`; valid date instant                         |
| `endInstantMs` | `Float64Array` when distinct | Must not precede `instantMs`                                              |
| `bpm`          | `Float64Array`               | Preserves accepted integer or fractional source values from 1 through 300 |
| `sourceId`     | interned dictionary index    | References preserved `originDataSourceId`                                 |
| `sourceOrder`  | unsigned integer             | Stable tie-breaker for equal instants                                     |

### Identity and Ordering

- Canonical order is `instantMs`, then `sourceOrder`.
- Duplicate identity is the tuple of start instant, end instant, bpm, and source identifier.
- Identical tuples after sorting retain the first record and increment the duplicate count.
- Readings at the same instant with different bpm or source identifiers remain distinct.

## Validation Result

Each parsed item receives exactly one terminal category.

| Category     | Meaning                                                                             |
| ------------ | ----------------------------------------------------------------------------------- |
| `accepted`   | All required fields are valid and the tuple is unique                               |
| `duplicate`  | Tuple is identical to a previously accepted reading after canonical sorting         |
| `missing`    | A required path is absent or null                                                   |
| `malformed`  | A required token has the wrong type, cannot be parsed, or has invalid time ordering |
| `outOfRange` | Parsed bpm is below 1 or above 300                                                  |

Malformed top-level JSON or a missing `Data Points` array is an import-level failure. Record-level
failures produce a partial-data result when at least one reading is accepted.

## Dataset

Worker-owned committed representation of all accepted readings.

| Field              | Type                  | Rules                                            |
| ------------------ | --------------------- | ------------------------------------------------ |
| `datasetId`        | string                | Changes only after successful replacement commit |
| `timestamps`       | typed array           | Sorted ascending                                 |
| `endTimestamps`    | typed array or absent | Allocated only when source intervals require it  |
| `bpmValues`        | typed array           | Index-aligned with timestamps                    |
| `sourceIds`        | typed array           | Index-aligned with timestamps                    |
| `sourceDictionary` | string array          | Unique source metadata strings                   |
| `counts`           | Validation Counts     | Immutable after commit                           |
| `fullRange`        | Time Band             | First through last accepted instant              |
| `levels`           | aggregate levels      | Pixel-bounded min/max query acceleration         |

## Time Band

Canonical inclusive visible interval.

| Field      | Type                                             | Rules                                         |
| ---------- | ------------------------------------------------ | --------------------------------------------- |
| `startMs`  | integer milliseconds                             | Within dataset full range                     |
| `endMs`    | integer milliseconds                             | Greater than or equal to `startMs`            |
| `revision` | non-negative integer                             | Increases for every committed range change    |
| `origin`   | `brush`, `touch`, `fields`, `nested`, or `reset` | Used for focus and announcement behavior only |

Brush, touch, and fields all update this same entity. Invalid or ambiguous local date/time input does
not mutate the current Time Band.

## Visible Summary

Derived from exact readings whose instants fall inside the Time Band.

| Field            | Type                 | Rule                                |
| ---------------- | -------------------- | ----------------------------------- |
| `count`          | non-negative integer | Number of exact accepted readings   |
| `minimumBpm`     | number or absent     | Absent when count is zero           |
| `maximumBpm`     | number or absent     | Absent when count is zero           |
| `meanBpm`        | number or absent     | Arithmetic mean from exact readings |
| `durationMs`     | non-negative integer | `endMs - startMs`                   |
| `firstInstantMs` | integer or absent    | First included reading              |
| `lastInstantMs`  | integer or absent    | Last included reading               |

## Display Series

Bounded chart projection returned by the worker.

| Field              | Type                            | Rules                                                    |
| ------------------ | ------------------------------- | -------------------------------------------------------- |
| `timestamps`       | transferable numeric array      | Chronological; bounded by chart width                    |
| `bpmValues`        | transferable numeric array      | Source values or preserved bucket representatives        |
| `sourceIndexes`    | transferable numeric array      | Maps each plotted value to an exact reading              |
| `gapBefore`        | transferable boolean/byte array | True when prior exact reading is over 30 minutes earlier |
| `mode`             | `exact` or `aggregated`         | Always disclosed to the UI                               |
| `bucketDurationMs` | integer or absent               | Present only in aggregated mode                          |

An aggregated bucket includes unique source indexes for first, last, minimum, and maximum readings,
ordered chronologically. It never contains an averaged synthetic point.

## Reading Page

A bounded non-visual window over exact readings in the current Time Band.

| Field           | Type                 | Rules                                                        |
| --------------- | -------------------- | ------------------------------------------------------------ |
| `rangeRevision` | integer              | Must match current Time Band before display                  |
| `page`          | positive integer     | One-based                                                    |
| `pageSize`      | integer              | Fixed supported options; default 50                          |
| `totalRows`     | non-negative integer | Exact readings in range                                      |
| `rows`          | reading summaries    | At most `pageSize`; local formatted time plus offset and bpm |

## Relationships

```text
Import Session 1 -> 0..1 Dataset
Dataset 1 -> many Heart Rate Readings
Dataset 1 -> 1 full Time Band
Time Band 1 -> 1 Visible Summary
Time Band 1 -> 1 Display Series per chart-width query
Time Band 1 -> many Reading Pages over time
Heart Rate Reading many -> 1 interned source identifier
```
