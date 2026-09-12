# Contract: Google Fit Heart-Rate JSON

## Supported Package

The first release accepts exactly one JSON file matching the supplied derived Google Fit heart-rate
export. It does not discover files in folders or archives and does not accept multiple files.

## Top-Level Shape

```json
{
  "Data Points": [
    {
      "fitValue": [{ "value": { "fpVal": 70 } }],
      "originDataSourceId": "raw:com.google.heart_rate.bpm:provider:source",
      "endTimeNanos": 1789153727000000000,
      "dataTypeName": "com.google.heart_rate.bpm",
      "startTimeNanos": 1789153727000000000,
      "modifiedTimeMillis": 1789206582508,
      "rawTimestampNanos": 0
    }
  ]
}
```

Unknown top-level and record properties are ignored. Required paths and classification are defined
below. Property order is irrelevant.

## Required Record Mapping

| JSON path                 | Accepted form                                | Normalized meaning                       |
| ------------------------- | -------------------------------------------- | ---------------------------------------- |
| `dataTypeName`            | String equal to `com.google.heart_rate.bpm`  | Confirms heart-rate record               |
| `startTimeNanos`          | Integer JSON token or decimal integer string | Measurement start as an absolute instant |
| `endTimeNanos`            | Integer JSON token or decimal integer string | Measurement end as an absolute instant   |
| `fitValue[0].value.fpVal` | Finite JSON number from 1 through 300        | Heart rate in beats per minute           |
| `originDataSourceId`      | String when present                          | Preserved source identity metadata       |

`modifiedTimeMillis` and `rawTimestampNanos` are optional metadata and never replace measurement
timestamps. Additional `fitValue` entries are preserved only if the restored fixture proves they
carry source identity needed by the duplicate rule; they do not provide alternate bpm values.

## Precision and Time Rules

1. The parser adapter MUST receive nanosecond values as token text, not an already-rounded number.
2. Parse token text as `BigInt` and derive milliseconds with integer division by `1_000_000n`.
3. Preserve the absolute instant; format it in the browser's current local timezone for display.
4. `endTimeNanos` MUST be greater than or equal to `startTimeNanos`.
5. A line gap exists when the elapsed time between consecutive accepted start instants is greater
   than 1,800,000 milliseconds.

Sub-millisecond precision cannot affect the graph or user-entered millisecond range controls, but raw
token text MAY be retained during validation when needed to distinguish duplicate records.

## Record Classification

| Condition                                                                    | Classification |
| ---------------------------------------------------------------------------- | -------------- |
| Required path absent or null                                                 | `missing`      |
| Wrong type, invalid integer token, invalid date instant, or end before start | `malformed`    |
| bpm below 1 or above 300                                                     | `outOfRange`   |
| Identical start, end, bpm, and source tuple                                  | `duplicate`    |
| All rules pass and tuple is unique                                           | `accepted`     |

Records with another `dataTypeName` are `malformed` because this single-schema file is expected to
contain heart-rate data. Import succeeds with a partial-data result when at least one record is
accepted. Import fails without replacing current data when JSON is malformed, `Data Points` is absent
or not an array, the record cap is exceeded, or no records are accepted.

## Streaming Requirements

- Parse incrementally from `File.stream()` with bounded internal buffers.
- Emit coarse progress without retaining raw record objects.
- Stop and release staging data on cancellation or fatal import failure.
- Reject after more than 1,000,000 accepted records; do not silently truncate.
- Never log source records, file contents, or source identifiers.

## Contract Fixtures

Committed fixtures MUST be synthetic and small. They cover:

- the representative shape above;
- JSON tokens split at every meaningful parser boundary;
- nanosecond values beyond the exact integer range of JavaScript numbers;
- missing, malformed, out-of-range, duplicate, equal-timestamp, and out-of-order records;
- daylight-saving transitions and differing offsets;
- malformed top-level JSON and missing `Data Points`;
- 30-minute and just-over-30-minute gaps.

A private ignored copy of the supplied export MUST pass this contract before release.
