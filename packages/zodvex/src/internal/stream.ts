import type {
  DataModelFromSchemaDefinition,
  DocumentByInfo,
  GenericDatabaseReader,
  GenericTableInfo,
  IndexNames,
  IndexRange,
  NamedIndex,
  NamedTableInfo,
  SchemaDefinition,
  TableNamesInDataModel
} from 'convex/server'
import { mergedStream, type QueryStream, stream } from 'convex-helpers/server/stream'
import type { ResolveDecodedDoc, ZodvexDatabaseReader, ZodvexIndexRangeBuilder } from './db'
import type { ZodTableMap } from './schema'
import {
  $ZodCodec,
  $ZodDefault,
  $ZodNullable,
  $ZodObject,
  $ZodOptional,
  $ZodType,
  $ZodUnion
} from './zod-core'

/**
 * Typed convex-helpers stream interop for the secure DatabaseReader (#78).
 *
 * convex-helpers' `stream()` / `mergedStream()` enable honest pagination over
 * set-valued equality predicates (`roomId IN {a, b, c}`): fan out one
 * substream per value over an index and k-way merge them with index-key
 * cursors that stay valid across all substreams.
 *
 * `stream()` nominally requires a `GenericDatabaseReader`, which the zodvex
 * secure reader doesn't implement (its `query()` returns the decoded chain).
 * This module provides the typed entry point so call sites never cast:
 *
 * - The unavoidable cast lives in ONE audited place (`zodvexStream`), pinned
 *   by tests that exercise the duck-typed surface stream() relies on
 *   (`db.query(table).withIndex(...).order(...)` + async iteration), so a
 *   chain-surface change fails loudly in zodvex CI rather than silently
 *   downstream.
 * - Item/page types are the DECODED doc types (codec outputs applied), which
 *   is what the zodvex chain actually yields — not convex-helpers' raw
 *   `DocumentByName` types.
 *
 * Rules semantics: streams are rules-preserving. Every streamed row flows
 * through the secure chain (decode + read rules evaluated per row
 * mid-stream). If a read rule denies a row inside a substream, the row is
 * simply never yielded — the merged index-key cursor never includes it, so
 * there are no holes and no stuck cursors. Rules act as a backstop; fan-out
 * queries should already narrow to authorized index ranges.
 */

/** Convex stream items must be non-nullish (mirrors convex-helpers' unexported GenericStreamItem). */
type StreamItem = NonNullable<unknown>

/**
 * A stream of DECODED documents. Alias of convex-helpers' `QueryStream` with
 * the item type corrected to what the zodvex chain actually yields, so
 * `paginate()` / `collect()` / iteration return decoded docs.
 */
export type ZodvexQueryStream<T extends StreamItem> = QueryStream<T>

/** Ordered stream over decoded documents — mergeable and paginatable. */
export interface ZodvexOrderedStreamQuery<T extends StreamItem> extends QueryStream<T> {}

/** Stream query with an index applied; `.order()` yields the mergeable stream. */
export interface ZodvexStreamQuery<T extends StreamItem> extends QueryStream<T> {
  order(order: 'asc' | 'desc'): ZodvexOrderedStreamQuery<T>
}

/**
 * Entry point for a single table's stream. Mirrors convex-helpers'
 * `StreamQueryInitializer` surface, but `withIndex` uses zodvex's
 * decoded-aware index range builder (codec fields accept decoded values,
 * e.g. Date) and terminal types are decoded docs.
 */
export interface ZodvexStreamQueryInitializer<
  TableInfo extends GenericTableInfo,
  T extends StreamItem
> extends ZodvexStreamQuery<T> {
  fullTableScan(): ZodvexStreamQuery<T>
  withIndex<IndexName extends IndexNames<TableInfo>>(
    indexName: IndexName,
    indexRange?: (
      q: ZodvexIndexRangeBuilder<DocumentByInfo<TableInfo>, T, NamedIndex<TableInfo, IndexName>>
    ) => IndexRange
  ): ZodvexStreamQuery<T>
}

/** A defineZodSchema() result — a Convex schema carrying the zod table map. */
export type ZodvexStreamableSchema = SchemaDefinition<any, boolean> & {
  __zodTableMap: ZodTableMap
}

/** Extracts the phantom decoded-doc map carried by defineZodSchema results. */
type DecodedDocsOf<Schema> = Schema extends { __decodedDocs: infer DD extends Record<string, any> }
  ? DD
  : Record<string, any>

/**
 * The stream-flavored secure reader: same fluent surface as convex-helpers'
 * `stream(db, schema)`, typed against decoded documents.
 */
export interface ZodvexStreamDatabaseReader<Schema extends ZodvexStreamableSchema> {
  query<TableName extends TableNamesInDataModel<DataModelFromSchemaDefinition<Schema>>>(
    tableName: TableName
  ): ZodvexStreamQueryInitializer<
    NamedTableInfo<DataModelFromSchemaDefinition<Schema>, TableName>,
    NonNullable<
      ResolveDecodedDoc<DataModelFromSchemaDefinition<Schema>, DecodedDocsOf<Schema>, TableName>
    >
  >
}

/**
 * Creates a typed convex-helpers stream over the zodvex secure reader —
 * no cast at call sites.
 *
 * Every streamed row flows through the secure chain: codec decode plus any
 * read rules / audit wrappers attached to the reader. Use with
 * `zodvexMergedStream` to paginate fan-out queries over set-valued equality
 * predicates.
 *
 * @example
 * ```ts
 * const substreams = rooms.map(roomId =>
 *   zodvexStream(ctx.db, schema)
 *     .query('visits')
 *     .withIndex('tenantId_roomId_status', q => q.eq('tenantId', tenantId).eq('roomId', roomId))
 *     .order('asc')
 * )
 * return zodvexMergedStream(substreams, ['status', '_creationTime']).paginate(opts)
 * ```
 */
export function zodvexStream<Schema extends ZodvexStreamableSchema>(
  db: ZodvexDatabaseReader<DataModelFromSchemaDefinition<Schema>, any>,
  schema: Schema
): ZodvexStreamDatabaseReader<Schema> {
  // THE one audited cast (#78). The secure reader doesn't nominally implement
  // GenericDatabaseReader, but it is duck-type compatible with the surface
  // stream() uses: db.query(table).withIndex(index, range).order(order) plus
  // async iteration. That surface is pinned by __tests__/stream.test.ts.
  const rawDb = db as unknown as GenericDatabaseReader<DataModelFromSchemaDefinition<Schema>>
  return stream(rawDb, schema) as unknown as ZodvexStreamDatabaseReader<Schema>
}

/**
 * Merge multiple zodvex streams into a single stream ordered by
 * `orderByIndexFields`, suitable for `.paginate()` with cursors that stay
 * valid across all substreams. Thin wrapper over convex-helpers'
 * `mergedStream` that keeps decoded item types and rejects codec-backed
 * merge keys.
 *
 * Codec-backed fields are FORBIDDEN in `orderByIndexFields`: the merge
 * comparator reads index-key values off the yielded (decoded) documents,
 * while the underlying Convex index is ordered by wire values — decoded
 * comparisons can mis-order the merge and produce invalid cursors. Pin codec
 * fields with `.eq()` inside each substream and order by non-codec fields
 * (e.g. '_creationTime') instead.
 */
export function zodvexMergedStream<T extends StreamItem>(
  streams: ZodvexQueryStream<T>[],
  orderByIndexFields: string[]
): ZodvexQueryStream<T> {
  assertNoCodecOrderFields(streams, orderByIndexFields)
  return mergedStream(streams, orderByIndexFields)
}

/** Unwraps Optional/Nullable/Default wrappers to reach the structural type. */
function unwrapOuter(schema: $ZodType): $ZodType {
  let current: $ZodType = schema
  for (let i = 0; i < 10; i++) {
    if (
      current instanceof $ZodOptional ||
      current instanceof $ZodNullable ||
      current instanceof $ZodDefault
    ) {
      current = current._zod.def.innerType
      continue
    }
    break
  }
  return current
}

/**
 * Walks a (possibly dot-separated) field path through a doc schema and
 * reports whether it crosses a codec boundary — i.e. whether the decoded
 * value at that path differs from the wire value the index is ordered by.
 * Union doc schemas (union tables) flag the field if ANY variant is
 * codec-backed.
 */
function fieldIsCodecBacked(schema: $ZodType, segments: string[]): boolean {
  const current = unwrapOuter(schema)
  if (current instanceof $ZodCodec) return true
  if (segments.length === 0) return false
  if (current instanceof $ZodObject) {
    const fieldSchema = (current._zod.def.shape as Record<string, $ZodType | undefined>)[
      segments[0]
    ]
    return fieldSchema ? fieldIsCodecBacked(fieldSchema, segments.slice(1)) : false
  }
  if (current instanceof $ZodUnion) {
    const options = current._zod.def.options as readonly $ZodType[]
    return options.some(option => fieldIsCodecBacked(option, segments))
  }
  return false
}

/**
 * Best-effort guard: for every stream that exposes `reflect()` (any stream
 * built via zodvexStream(...).query(...)), look up the table's doc schema in
 * the zodvex table map and reject codec-backed `orderByIndexFields`.
 * Derived streams (filterWith/map) don't reflect and pass through unchecked.
 */
function assertNoCodecOrderFields(
  streams: ZodvexQueryStream<any>[],
  orderByIndexFields: string[]
): void {
  for (const s of streams) {
    const reflect = (s as { reflect?: () => { schema?: unknown; table?: string } }).reflect
    if (typeof reflect !== 'function') continue
    const { schema, table } = reflect.call(s) ?? {}
    const tableMap = (schema as { __zodTableMap?: ZodTableMap } | undefined)?.__zodTableMap
    const docSchema = table ? tableMap?.[table]?.doc : undefined
    if (!docSchema) continue
    for (const field of orderByIndexFields) {
      if (field === '_creationTime' || field === '_id') continue
      if (fieldIsCodecBacked(docSchema, field.split('.'))) {
        throw new Error(
          `zodvexMergedStream: orderByIndexFields contains codec-backed field '${field}' ` +
            `(table '${table}'). The merge comparator reads decoded values off yielded docs, ` +
            `but the underlying index is ordered by wire values — codec-backed merge keys can ` +
            `mis-order results and produce invalid cursors. Pin codec fields with .eq() inside ` +
            `each substream and order by non-codec fields (e.g. '_creationTime') instead.`
        )
      }
    }
  }
}
