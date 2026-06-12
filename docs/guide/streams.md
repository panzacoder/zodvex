# Streams: `zodvexStream` and `zodvexMergedStream`

Typed interop with [`convex-helpers/server/stream`](https://github.com/get-convex/convex-helpers#composable-querystreams) for the zodvex secure `ctx.db` — no casts at call sites, decoded document types end to end.

## When you need streams

Streams matter for one specific, increasingly common query shape: **honest pagination over a set-valued equality predicate**. `roomId IN {a, b, c}` is not a single Convex index range, so the only way to paginate it without post-fetch filtering (short/uneven pages, dead scans) is to fan out one substream per value over an index like `(tenantId, roomId, status)` and k-way merge them. Index-key cursors stay valid across all substreams.

## Usage

```ts
import { zodvexMergedStream, zodvexStream } from 'zodvex/server'
import schema from './schema'

export const visitsForRooms = zq({
  args: { rooms: z.array(z.string()), paginationOpts: zx.paginationOpts() },
  handler: async (ctx, { rooms, paginationOpts }) => {
    const substreams = rooms.map(roomId =>
      zodvexStream(ctx.db, schema)
        .query('visits')
        .withIndex('tenantId_roomId', q => q.eq('tenantId', tenantId).eq('roomId', roomId))
        .order('asc')
    )
    return zodvexMergedStream(substreams, ['_creationTime']).paginate(paginationOpts)
  }
})
```

`zodvexStream(db, schema)` takes the secure reader (`ctx.db` from `initZodvex` builders — readers and writers both work) and the `defineZodSchema()` result. The returned stream has the same fluent surface as convex-helpers' `stream()`.

## What you get over a raw cast

Without this entry point, the working pattern was a double-cast (`ctx.db as unknown as GenericDatabaseReader<DataModel>`), which lies twice:

1. The cast asserts, per call site and unaudited, that the secure reader is a raw reader.
2. convex-helpers types streamed docs as raw wire documents, but the zodvex reader actually yields **decoded** docs (codec outputs applied — `Date` instead of `number`, etc.).

`zodvexStream` fixes both:

- The unavoidable cast lives in **one audited place** inside zodvex, pinned by tests that exercise the duck-typed surface `stream()` relies on (`db.query(table).withIndex(...).order(...)` plus async iteration). If a future zodvex version changes the chain surface, zodvex CI fails loudly — not your app, silently.
- Item and page types are the **decoded** doc types, so `mergedStream(...).paginate()` returns pages that match what zodvex actually yields.

## Rules semantics

Streams are **rules-preserving**: every streamed row flows through the secure chain, so codec decode and any `.withRules()` / `.audit()` wrappers on the reader apply per row, mid-stream.

If a read rule denies a row inside a substream, the row is simply never yielded — the merged index-key cursor never includes it, so there are **no holes and no stuck cursors**. Treat rules as a backstop for fan-out queries: the query should already narrow to authorized index ranges.

## Codec fields as merge-order keys are forbidden

`zodvexMergedStream` throws if any field in `orderByIndexFields` is codec-backed (e.g. a `zx.date()` field):

```ts
// ✗ throws — scheduledAt is a codec field
zodvexMergedStream(substreams, ['scheduledAt'])

// ✓ pin codec fields with .eq() inside each substream, order by non-codec fields
zodvexMergedStream(substreams, ['_creationTime'])
```

The merge comparator reads index-key values off the *yielded* (decoded) documents, while the underlying Convex index is ordered by *wire* values — decoded comparisons can mis-order the merge, and decoded values (like `Date`) are not serializable into pagination cursors.

The guard is **fail-fast**: stream construction is lazy, so the throw fires synchronously at `zodvexMergedStream()` call time, before anything touches the database — a query-build-time error, not a mid-pagination surprise after N pages.

**Guard scope:** the codec merge-key guard only protects substreams created via `zodvexStream` — it works by reflecting the table's zodvex schema off each stream. Substreams built with raw convex-helpers `stream()` (e.g. legacy cast-based call sites mid-migration), or derived streams that don't reflect (`filterWith`, `map`), still merge fine but get no codec check. This is intentional — raw streams are the incremental-migration path — but mixed raw/zodvex stream arrays get no protection on the raw members.

The same caution applies to paginating a single stream whose index range is *bounded* (not `.eq()`-pinned) on a codec field: cursors serialize index-key values from decoded docs. Prefer indexes whose ordering tail is non-codec (`_creationTime` is always safe).

## API

| Export | Description |
| --- | --- |
| `zodvexStream(db, schema)` | Typed `stream()` over the secure reader. Returns a `ZodvexStreamDatabaseReader`. |
| `zodvexMergedStream(streams, orderByIndexFields)` | Typed `mergedStream()` with the codec merge-key guard. Returns a `ZodvexQueryStream<T>`. |
| `ZodvexQueryStream<T>` | A convex-helpers `QueryStream` with decoded item types — supports `paginate`, `collect`, `take`, `first`, `unique`, `filterWith`, `map`, `distinct`, and async iteration. |
| `ZodvexStreamDatabaseReader` / `ZodvexStreamQueryInitializer` / `ZodvexStreamQuery` / `ZodvexOrderedStreamQuery` | The typed fluent surface mirroring convex-helpers' stream classes. |

Streams compose with everything `QueryStream` supports — `filterWith` for TypeScript-side filtering (still counts as read bandwidth), `map`, `distinct` for loose index scans — all yielding decoded documents.
