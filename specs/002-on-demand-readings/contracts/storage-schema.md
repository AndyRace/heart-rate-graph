# Contract: Persistent Index and Binary Storage

**Database name**: `heart-rate-graph`  
**IndexedDB schema version**: `2`  
**Index format version**: `1`

## Object Stores

| Store         | Key                       | Value                                    | Indexes                         |
| ------------- | ------------------------- | ---------------------------------------- | ------------------------------- |
| `control`     | string                    | singleton control records                | none                            |
| `generations` | `generationId`            | source generation metadata               | `by-status`, `by-source-digest` |
| `manifests`   | `generationId`            | complete immutable manifest              | none                            |
| `chunks`      | `[generationId, chunkId]` | chunk metadata and `ArrayBuffer` payload | `by-generation`                 |
| `stagingRuns` | `[generationId, runId]`   | temporary run metadata and payload       | `by-generation`                 |

Schema upgrades must close old connections on `versionchange`, expose blocked-upgrade feedback, and never reinterpret an unsupported binary format as current data.

## Publication Transaction

A candidate generation becomes queryable only through one `readwrite` transaction over `generations`, `manifests`, and `control`:

1. Verify every final chunk write completed and the candidate still has status `finalizing`.
2. Add the immutable manifest.
3. Update generation metadata to `ready` with final counts and digest.
4. Replace `control['active-generation']` with the candidate generation ID.
5. Await every request and `transaction.done`.

No parsing, hashing, yielding, network operation, or unrelated promise may occur inside this transaction. If any operation fails, the transaction aborts and the prior active pointer remains unchanged.

## Chunk Descriptor

```ts
interface ChunkDescriptor {
  chunkId: number;
  rowCount: number;
  byteLength: number;
  minimumInstantNs: bigint;
  maximumInstantNs: bigint;
  firstSourceOrder: number;
  lastSourceOrder: number;
  checksum: string;
}
```

Descriptors are ordered by `(minimumInstantNs, firstSourceOrder)`. A range lookup selects descriptors whose closed timestamp interval intersects the requested closed interval. The decoder must still binary-search rows because boundary chunks can contain readings outside the request.

## Binary Chunk Format Version 1

All multi-byte values are little-endian. The header uses fixed offsets and is followed by aligned column sections.

| Header field        | Width                             | Meaning                                        |
| ------------------- | --------------------------------- | ---------------------------------------------- |
| Magic               | 8 bytes                           | ASCII `HRGCHNK1`                               |
| Format version      | unsigned 16-bit                   | `1`                                            |
| Header length       | unsigned 16-bit                   | Allows future extension                        |
| Row count           | unsigned 32-bit                   | 1 through 16,384                               |
| Timestamp offset    | unsigned 32-bit                   | Byte offset of `BigInt64Array` epoch-ns column |
| BPM offset          | unsigned 32-bit                   | Byte offset of `Float64Array` column           |
| Source ID offset    | unsigned 32-bit                   | Byte offset of `Uint32Array` column            |
| Source order offset | unsigned 32-bit                   | Byte offset of `Uint32Array` column            |
| Reserved            | implementation-defined zero bytes | Pads header and reserves evolution space       |

The payload length must exactly match the final column boundary. The descriptor checksum covers the complete payload, including header. The decoder rejects bad magic, unsupported version, invalid offsets, misalignment, row-count disagreement, non-monotonic ordering, invalid BPM values, or checksum mismatch.

## Staging Run Format

Staging runs use a separately identified versioned payload and may include parser-only fields needed to preserve validation and duplicate semantics. They are implementation details and must never be selected by range queries. A migration may discard all staging runs safely.

## Source Table

Source metadata is stored once per generation in the manifest. Chunk rows refer to it by unsigned 32-bit index. The table preserves existing source identifiers exactly and rejects out-of-range references during decode.

## Cleanup and Recovery

- On startup, generations in `indexing`, `finalizing`, `cancelled`, `failed`, or `invalid` state that are not active are cleanup candidates.
- Cleanup deletes stores by generation index in bounded transactions; it must yield between batches.
- Missing manifests, missing chunks, checksum failures, or count disagreements invalidate that generation.
- If the active generation is invalid, no readings are returned. The UI offers re-index and clear actions.
- A failed replacement never deletes or changes the previous active generation.
- `clear retained data` closes all app database connections, deletes the complete database, clears the decoded LRU, and returns the UI to no-source state.

## Retention and Privacy

All stores are origin-local. No service worker sync, telemetry payload, remote backup, URL serialization, or network request may contain source metadata, readings, summaries, chunks, manifests, or digests. The application may request persistent storage; denial changes only recovery messaging, not data semantics.

## Volatile Fallback Contract

When IndexedDB is unavailable or a new generation cannot fit, the user may choose a session-only import. A volatile chunk repository must use the same staging, manifest, checksum, publication, query, and cancellation rules as the persistent repository, but keeps encoded values in worker memory.

- The UI must disclose `retention: session` before indexing and while the generation is active.
- The application must not claim that the generation will reopen after refresh or tab closure.
- Range results remain on demand: only intersecting encoded chunks are decoded into the 16 MiB LRU and UI snapshots.
- A failed session-only replacement preserves any previously active durable generation until the replacement publishes.
- Clearing or terminating the worker removes volatile data; `clear retained data` also deletes IndexedDB data.
