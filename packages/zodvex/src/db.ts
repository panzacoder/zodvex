import type {
  DocumentByInfo,
  ExpressionOrValue,
  FieldPaths,
  FieldTypeFromFieldPath,
  FilterBuilder,
  GenericDatabaseReader,
  GenericDatabaseWriter,
  GenericDataModel,
  GenericDocument,
  GenericIndexFields,
  GenericTableInfo,
  IndexNames,
  IndexRange,
  NamedIndex,
  NamedSearchIndex,
  NamedTableInfo,
  PaginationOptions,
  PaginationResult,
  SearchFilter,
  SearchFilterBuilder,
  SearchIndexNames,
  TableNamesInDataModel
} from 'convex/server'
import type { GenericId, NumericValue } from 'convex/values'
import { z } from 'zod'
import { decodeDoc, encodeDoc, encodePartialDoc } from './codec'
import type { ReaderAuditConfig, WriterAuditConfig, ZodvexRulesConfig } from './ruleTypes'
import type { ZodTableMap } from './schema'
import { $ZodObject, $ZodUnion } from './zod-core'

// Lazy import to avoid circular dependency — rules.ts extends classes from this file.
// The dynamic import() fires after db.ts finishes initializing, so rules.ts can
// safely extend ZodvexDatabaseReader/Writer. By the time user code calls
// .withRules() or .audit(), the module is loaded and cached.
let _rules: typeof import('./rules') | null = null
const _rulesReady = import('./rules').then(m => {
  _rules = m
})
function getRules(): typeof import('./rules') {
  if (!_rules) {
    throw new Error(
      'zodvex rules module not yet loaded. This usually means .withRules() or .audit() ' +
        'was called at module scope. Move it inside a function handler.'
    )
  }
  return _rules
}

// ============================================================================
// Index builder types — decoded-aware replacements for Convex's IndexRangeBuilder
// ============================================================================

/**
 * Resolves the accepted value type for an index field comparison.
 *
 * - Dot-paths (e.g., "email.value"): resolve through the wire document,
 *   since dot-paths navigate into wire-format sub-structures.
 * - Top-level fields present in DecodedDoc: use the decoded (runtime) type,
 *   so codec fields accept decoded values (e.g., Date instead of number).
 * - Everything else: fall back to wire type via FieldTypeFromFieldPath.
 */
export type ZodvexIndexFieldValue<
  WireDoc extends GenericDocument,
  DecodedDoc,
  FieldPath extends string
> = FieldPath extends `${string}.${string}`
  ? FieldTypeFromFieldPath<WireDoc, FieldPath>
  : FieldPath extends keyof DecodedDoc
    ? DecodedDoc[FieldPath]
    : FieldTypeFromFieldPath<WireDoc, FieldPath>

/** Increments a numeric type literal by 1 (up to 15). Mirrors Convex's internal PlusOne. */
type PlusOne<N extends number> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15][N]

/**
 * Decoded-aware index range builder. Mirrors Convex's IndexRangeBuilder but uses
 * ZodvexIndexFieldValue for comparison value types, so codec fields accept
 * decoded/runtime types (e.g., Date) instead of requiring wire types (e.g., number).
 */
export interface ZodvexIndexRangeBuilder<
  WireDoc extends GenericDocument,
  DecodedDoc,
  IndexFields extends GenericIndexFields,
  FieldNum extends number = 0
> extends ZodvexLowerBoundBuilder<WireDoc, DecodedDoc, IndexFields[FieldNum]> {
  eq(
    fieldName: IndexFields[FieldNum],
    value: ZodvexIndexFieldValue<WireDoc, DecodedDoc, IndexFields[FieldNum]>
  ): ZodvexNextBuilder<WireDoc, DecodedDoc, IndexFields, FieldNum>
}

/** After .eq(), either another ZodvexIndexRangeBuilder (more fields) or IndexRange (done). */
type ZodvexNextBuilder<
  WireDoc extends GenericDocument,
  DecodedDoc,
  IndexFields extends GenericIndexFields,
  FieldNum extends number
> =
  PlusOne<FieldNum> extends IndexFields['length']
    ? IndexRange
    : ZodvexIndexRangeBuilder<WireDoc, DecodedDoc, IndexFields, PlusOne<FieldNum>>

/** Lower bound builder with decoded-aware value types. */
export interface ZodvexLowerBoundBuilder<
  WireDoc extends GenericDocument,
  DecodedDoc,
  IndexFieldName extends string
> extends ZodvexUpperBoundBuilder<WireDoc, DecodedDoc, IndexFieldName> {
  gt(
    fieldName: IndexFieldName,
    value: ZodvexIndexFieldValue<WireDoc, DecodedDoc, IndexFieldName>
  ): ZodvexUpperBoundBuilder<WireDoc, DecodedDoc, IndexFieldName>
  gte(
    fieldName: IndexFieldName,
    value: ZodvexIndexFieldValue<WireDoc, DecodedDoc, IndexFieldName>
  ): ZodvexUpperBoundBuilder<WireDoc, DecodedDoc, IndexFieldName>
}

/** Upper bound builder with decoded-aware value types. */
export interface ZodvexUpperBoundBuilder<
  WireDoc extends GenericDocument,
  DecodedDoc,
  IndexFieldName extends string
> extends IndexRange {
  lt(
    fieldName: IndexFieldName,
    value: ZodvexIndexFieldValue<WireDoc, DecodedDoc, IndexFieldName>
  ): IndexRange
  lte(
    fieldName: IndexFieldName,
    value: ZodvexIndexFieldValue<WireDoc, DecodedDoc, IndexFieldName>
  ): IndexRange
}

// ============================================================================
// Filter builder types — decoded-aware replacements for Convex's FilterBuilder
// ============================================================================

declare const _zodvexExpr: unique symbol
export type ZodvexExpression<T> = { readonly [_zodvexExpr]: T }
export type ZodvexExpressionOrValue<T> = ZodvexExpression<T> | T

export interface ZodvexFilterBuilder<
  TableInfo extends GenericTableInfo,
  Doc = DocumentByInfo<TableInfo>
> {
  field<FP extends FieldPaths<TableInfo>>(
    fieldPath: FP
  ): ZodvexExpression<ZodvexIndexFieldValue<DocumentByInfo<TableInfo>, Doc, FP>>

  eq<T>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<boolean>
  neq<T>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<boolean>
  lt<T>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<boolean>
  lte<T>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<boolean>
  gt<T>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<boolean>
  gte<T>(l: ZodvexExpressionOrValue<T>, r: ZodvexExpressionOrValue<T>): ZodvexExpression<boolean>

  and(...exprs: ZodvexExpressionOrValue<boolean>[]): ZodvexExpression<boolean>
  or(...exprs: ZodvexExpressionOrValue<boolean>[]): ZodvexExpression<boolean>
  not(x: ZodvexExpressionOrValue<boolean>): ZodvexExpression<boolean>

  add<T extends NumericValue>(
    l: ZodvexExpressionOrValue<T>,
    r: ZodvexExpressionOrValue<T>
  ): ZodvexExpression<T>
  sub<T extends NumericValue>(
    l: ZodvexExpressionOrValue<T>,
    r: ZodvexExpressionOrValue<T>
  ): ZodvexExpression<T>
  mul<T extends NumericValue>(
    l: ZodvexExpressionOrValue<T>,
    r: ZodvexExpressionOrValue<T>
  ): ZodvexExpression<T>
  div<T extends NumericValue>(
    l: ZodvexExpressionOrValue<T>,
    r: ZodvexExpressionOrValue<T>
  ): ZodvexExpression<T>
  mod<T extends NumericValue>(
    l: ZodvexExpressionOrValue<T>,
    r: ZodvexExpressionOrValue<T>
  ): ZodvexExpression<T>
  neg<T extends NumericValue>(x: ZodvexExpressionOrValue<T>): ZodvexExpression<T>
}

/**
 * Encodes a comparison value for an index field through its Zod schema.
 *
 * - Top-level fields: encoded through their schema (codec fields transform,
 *   non-codec fields are identity).
 * - Dot-paths: pass through unchanged (they target wire-format sub-fields
 *   where the comparison value is already the correct primitive type).
 */
function encodeIndexValue(schema: z.ZodTypeAny, fieldPath: string, value: any): any {
  // Dot-paths target wire-format sub-fields — value is already correct
  if (fieldPath.includes('.')) return value

  // Object schemas: encode through the field's schema directly
  if (schema instanceof $ZodObject) {
    const fieldSchema = (schema as z.ZodObject<any>).shape[fieldPath]
    if (fieldSchema) return z.encode(fieldSchema, value)
  }

  // Union schemas (ZodDiscriminatedUnion extends ZodUnion): build a per-field
  // union from all variants, then encode through that. Handles discriminator
  // literals and codec fields (e.g., zx.date()) correctly.
  // Non-object variants are skipped — union tables require object variants.
  if (schema instanceof $ZodUnion) {
    const options = (schema as any).options as z.ZodTypeAny[]
    const fieldSchemas = options
      .filter((v): v is z.ZodObject<any> => v instanceof $ZodObject)
      .map(v => v.shape[fieldPath])
      .filter(Boolean)
    if (fieldSchemas.length === 1) return z.encode(fieldSchemas[0], value)
    if (fieldSchemas.length > 1)
      return z.encode(
        z.union(fieldSchemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]),
        value
      )
  }

  return value
}

/**
 * Wraps a Convex IndexRangeBuilder (or any builder with eq/gt/gte/lt/lte methods)
 * with automatic value encoding. Each comparison method encodes its value through
 * the table's doc schema before forwarding to the real builder.
 *
 * Returns another wrapped builder so chained calls (e.g., .eq().gte().lt()) are
 * all encoded.
 */
function wrapIndexRangeBuilder(inner: any, schema: z.ZodTypeAny): any {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && ['eq', 'gt', 'gte', 'lt', 'lte'].includes(prop)) {
        return (fieldName: string, value: any) => {
          const encoded = encodeIndexValue(schema, fieldName, value)
          const result = target[prop](fieldName, encoded)
          return wrapIndexRangeBuilder(result, schema)
        }
      }
      // Wrap .search() return value so SearchFilterFinalizer.eq() is encoded
      if (prop === 'search') {
        return (...args: any[]) => {
          const result = target.search(...args)
          return wrapIndexRangeBuilder(result, schema)
        }
      }
      return Reflect.get(target, prop, receiver)
    }
  })
}

function extractFieldPath(expr: any): string | null {
  if (expr && typeof expr.serialize === 'function') {
    const inner = expr.serialize()
    if (inner && typeof inner === 'object' && '$field' in inner) {
      return inner.$field
    }
  }
  return null
}

function wrapFilterBuilder(inner: any, schema: z.ZodTypeAny): any {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && ['eq', 'neq', 'lt', 'lte', 'gt', 'gte'].includes(prop)) {
        return (l: any, r: any) => {
          const lField = extractFieldPath(l)
          const rField = extractFieldPath(r)
          if (lField && !rField) {
            r = encodeIndexValue(schema, lField, r)
          } else if (rField && !lField) {
            l = encodeIndexValue(schema, rField, l)
          }
          return target[prop](l, r)
        }
      }
      return Reflect.get(target, prop, receiver)
    }
  })
}

/**
 * Wraps a Convex query chain, decoding documents through a Zod schema
 * at terminal methods (first, unique, collect, take, paginate).
 *
 * Two type contexts (dual-generic design):
 * - `TableInfo`: Convex's wire-format table info. Used by intermediate methods
 *   (filter, etc.) so FilterBuilder sees wire-format field types.
 * - `Doc`: The decoded/runtime document type. Used by terminal methods
 *   (first, collect, paginate, etc.) and by ZodvexIndexRangeBuilder in
 *   withIndex, so codec fields accept decoded values (e.g., Date).
 *
 * Consumer code never passes these generics manually — they're inferred
 * from ZodvexDatabaseReader.query() which gets them from defineZodSchema's
 * captured type parameter.
 *
 * Does NOT implement QueryInitializer<TableInfo> because terminal methods
 * return Doc (decoded) instead of DocumentByInfo<TableInfo> (wire).
 */
export class ZodvexQueryChain<TableInfo extends GenericTableInfo, Doc = DocumentByInfo<TableInfo>> {
  constructor(
    protected inner: any,
    protected schema: z.ZodTypeAny
  ) {}

  /** Factory method for intermediate methods. Subclasses override to return their own type. */
  protected createChain(inner: any): ZodvexQueryChain<TableInfo, Doc> {
    return new ZodvexQueryChain(inner, this.schema)
  }

  /** Decode a wire-format doc and cast to the decoded document type. */
  private decode(doc: any): Doc {
    return decodeDoc(this.schema, doc) as Doc
  }

  // --- Intermediate methods: wire-typed TableInfo for Convex machinery ---

  fullTableScan(): ZodvexQueryChain<TableInfo, Doc> {
    return this.createChain(this.inner.fullTableScan())
  }

  withIndex<IndexName extends IndexNames<TableInfo>>(
    indexName: IndexName,
    indexRange?: (
      q: ZodvexIndexRangeBuilder<DocumentByInfo<TableInfo>, Doc, NamedIndex<TableInfo, IndexName>>
    ) => IndexRange
  ): ZodvexQueryChain<TableInfo, Doc> {
    const wrappedRange = indexRange
      ? (q: any) => indexRange(wrapIndexRangeBuilder(q, this.schema))
      : undefined
    return this.createChain(this.inner.withIndex(indexName, wrappedRange))
  }

  withSearchIndex<IndexName extends SearchIndexNames<TableInfo>>(
    indexName: IndexName,
    searchFilter: (
      q: SearchFilterBuilder<DocumentByInfo<TableInfo>, NamedSearchIndex<TableInfo, IndexName>>
    ) => SearchFilter
  ): ZodvexQueryChain<TableInfo, Doc> {
    const wrappedFilter = (q: any) => searchFilter(wrapIndexRangeBuilder(q, this.schema))
    return this.createChain(this.inner.withSearchIndex(indexName, wrappedFilter))
  }

  order(order: 'asc' | 'desc'): ZodvexQueryChain<TableInfo, Doc> {
    return this.createChain(this.inner.order(order))
  }

  // Overload 1: decoded-aware predicate (tried first)
  filter(
    predicate: (q: ZodvexFilterBuilder<TableInfo, Doc>) => ZodvexExpressionOrValue<boolean>
  ): ZodvexQueryChain<TableInfo, Doc>
  // Overload 2: Convex-native predicate (backwards compatible)
  filter(
    predicate: (q: FilterBuilder<TableInfo>) => ExpressionOrValue<boolean>
  ): ZodvexQueryChain<TableInfo, Doc>
  // Implementation
  filter(predicate: any): ZodvexQueryChain<TableInfo, Doc> {
    const wrappedPredicate = (q: any) => predicate(wrapFilterBuilder(q, this.schema))
    return this.createChain(this.inner.filter(wrappedPredicate))
  }

  limit(n: number): ZodvexQueryChain<TableInfo, Doc> {
    return this.createChain(this.inner.limit(n))
  }

  count(): Promise<number> {
    return this.inner.count()
  }

  // --- Terminal methods: return decoded Doc type ---

  async first(): Promise<Doc | null> {
    const doc = await this.inner.first()
    return doc ? this.decode(doc) : null
  }

  async unique(): Promise<Doc | null> {
    const doc = await this.inner.unique()
    return doc ? this.decode(doc) : null
  }

  async collect(): Promise<Doc[]> {
    const docs = await this.inner.collect()
    return docs.map((doc: any) => this.decode(doc))
  }

  async take(n: number): Promise<Doc[]> {
    const docs = await this.inner.take(n)
    return docs.map((doc: any) => this.decode(doc))
  }

  async paginate(paginationOpts: PaginationOptions): Promise<PaginationResult<Doc>> {
    const result = await this.inner.paginate(paginationOpts)
    return {
      ...result,
      page: result.page.map((doc: any) => this.decode(doc))
    }
  }

  // --- AsyncIterable: decode each yielded document ---

  async *[Symbol.asyncIterator](): AsyncIterator<Doc> {
    for await (const doc of this.inner) {
      yield this.decode(doc)
    }
  }
}

/**
 * Resolves the decoded document type for a given table.
 * If the table has a decoded type in DecodedDocs, use it.
 * Otherwise fall back to DocumentByInfo (wire types = runtime types for tables without codecs).
 */
type ResolveDecodedDoc<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>,
  TableName extends TableNamesInDataModel<DataModel>
> = TableName extends keyof DecodedDocs
  ? DecodedDocs[TableName]
  : DocumentByInfo<NamedTableInfo<DataModel, TableName>>

/** System fields auto-managed by Convex — not writable by consumers. */
type SystemFields = '_id' | '_creationTime'

/** Decoded doc without system fields — for insert and replace values. */
type DecodedWriteValue<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>,
  TableName extends TableNamesInDataModel<DataModel>
> = Omit<ResolveDecodedDoc<DataModel, DecodedDocs, TableName>, SystemFields>

/** Partial decoded doc without system fields — for patch values. */
type DecodedPatchValue<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>,
  TableName extends TableNamesInDataModel<DataModel>
> = Partial<Omit<ResolveDecodedDoc<DataModel, DecodedDocs, TableName>, SystemFields>>

/**
 * Resolves a table name from a GenericId by iterating the tableMap
 * and calling normalizeId. Same approach as convex-helpers' WrapReader.
 */
function resolveTableName<DataModel extends GenericDataModel>(
  db: GenericDatabaseReader<DataModel>,
  tableMap: ZodTableMap,
  id: GenericId<any>
): string | null {
  for (const tableName of Object.keys(tableMap)) {
    // tableName is a dynamic string key — can't narrow to TableNamesInDataModel
    if (db.normalizeId(tableName as any, id as unknown as string)) {
      return tableName
    }
  }
  return null
}

/**
 * Wraps a GenericDatabaseReader with automatic Zod codec decoding on reads.
 * Documents from tables in the zodTableMap are decoded through their schema.
 * Tables not in the map pass through without decoding.
 * System tables always pass through.
 *
 * DecodedDocs is a phantom type carrying the decoded document types for each
 * table (computed by DecodedDocFor<T> from defineZodSchema). It's never
 * accessed at runtime — it only drives the Doc generic on ZodvexQueryChain
 * so terminal methods return decoded types (e.g., Date instead of number).
 *
 * Does NOT implement GenericDatabaseReader<DataModel> because query() returns
 * ZodvexQueryChain (with decoded terminal types) instead of QueryInitializer
 * (with wire terminal types).
 */
export class ZodvexDatabaseReader<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any> = Record<string, any>
> {
  system: GenericDatabaseReader<DataModel>['system']

  constructor(
    protected db: GenericDatabaseReader<DataModel>,
    protected tableMap: ZodTableMap
  ) {
    this.system = db.system
  }

  /** @internal Expose for wrapper construction (rules.ts, audit subclasses) */
  get _internals(): { db: GenericDatabaseReader<DataModel>; tableMap: ZodTableMap } {
    return { db: this.db, tableMap: this.tableMap }
  }

  normalizeId<TableName extends TableNamesInDataModel<DataModel>>(
    tableName: TableName,
    id: string
  ): GenericId<TableName> | null {
    return this.db.normalizeId(tableName, id)
  }

  get<TableName extends TableNamesInDataModel<DataModel>>(
    id: GenericId<TableName>
  ): Promise<ResolveDecodedDoc<DataModel, DecodedDocs, TableName> | null>
  /** @internal 2-arg form for table-first lookups */
  get(idOrTable: any, maybeId?: any): Promise<any>
  async get(idOrTable: any, maybeId?: any): Promise<any> {
    let tableName: string | null
    let doc: any

    if (maybeId !== undefined) {
      // get(table, id) form
      tableName = idOrTable as string
      // 2-arg get(table, id) is @internal in Convex types — cast required
      doc = await (this.db as any).get(idOrTable, maybeId)
    } else {
      // get(id) form
      doc = await this.db.get(idOrTable)
      tableName = doc ? resolveTableName(this.db, this.tableMap, idOrTable) : null
    }

    if (!doc) return null

    const schemas = tableName ? this.tableMap[tableName] : undefined
    return schemas ? decodeDoc(schemas.doc, doc) : doc
  }

  query<TableName extends TableNamesInDataModel<DataModel>>(
    tableName: TableName
  ): ZodvexQueryChain<
    NamedTableInfo<DataModel, TableName>,
    ResolveDecodedDoc<DataModel, DecodedDocs, TableName>
  > {
    const schemas = this.tableMap[tableName as string]
    const innerQuery = this.db.query(tableName)
    if (!schemas) {
      // No codec for this table — return unwrapped query as-is.
      // Wire types = runtime types for non-codec tables, and
      // ResolveDecodedDoc falls back to DocumentByInfo (wire) here.
      // Cast required: Convex QueryInitializer is structurally incompatible
      // with ZodvexQueryChain (decoded terminal return types).
      return innerQuery as any
    }
    return new ZodvexQueryChain<
      NamedTableInfo<DataModel, TableName>,
      ResolveDecodedDoc<DataModel, DecodedDocs, TableName>
    >(innerQuery, schemas.doc)
  }

  /**
   * Returns a new ZodvexDatabaseReader that applies per-table read rules.
   * The returned reader is also a ZodvexDatabaseReader, so `.withRules()` can be chained.
   */
  withRules<Ctx>(
    ctx: Ctx,
    rules: Record<string, any>,
    config?: ZodvexRulesConfig
  ): ZodvexDatabaseReader<DataModel, DecodedDocs> {
    return getRules().createRulesDatabaseReader(this, ctx, rules, config)
  }

  /**
   * Returns a new ZodvexDatabaseReader that fires audit callbacks on reads.
   * The returned reader is also a ZodvexDatabaseReader, so `.audit()` can be chained
   * with `.withRules()`.
   */
  audit(config: ReaderAuditConfig): ZodvexDatabaseReader<DataModel, DecodedDocs> {
    return getRules().createAuditDatabaseReader(this, config)
  }
}

/**
 * Wraps a GenericDatabaseWriter with automatic Zod codec encoding on writes
 * and decoding on reads. Delegates read operations to a ZodvexDatabaseReader.
 *
 * Does NOT implement GenericDatabaseWriter<DataModel> because query() returns
 * ZodvexQueryChain (decoded types) instead of QueryInitializer (wire types).
 */
export class ZodvexDatabaseWriter<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any> = Record<string, any>
> {
  private reader: ZodvexDatabaseReader<DataModel, DecodedDocs>
  system: GenericDatabaseWriter<DataModel>['system']

  constructor(
    private db: GenericDatabaseWriter<DataModel>,
    private tableMap: ZodTableMap
  ) {
    // DecodedDocs is phantom — the cast propagates the type through delegation.
    this.reader = new ZodvexDatabaseReader(db, tableMap) as ZodvexDatabaseReader<
      DataModel,
      DecodedDocs
    >
    this.system = db.system
  }

  /** @internal Expose for wrapper construction (rules.ts, audit subclasses) */
  get _internals(): {
    db: GenericDatabaseWriter<DataModel>
    tableMap: ZodTableMap
    reader: ZodvexDatabaseReader<DataModel, DecodedDocs>
  } {
    return { db: this.db, tableMap: this.tableMap, reader: this.reader }
  }

  // --- Read methods: delegate to reader ---

  normalizeId<TableName extends TableNamesInDataModel<DataModel>>(
    tableName: TableName,
    id: string
  ): GenericId<TableName> | null {
    return this.reader.normalizeId(tableName, id)
  }

  get<TableName extends TableNamesInDataModel<DataModel>>(
    id: GenericId<TableName>
  ): Promise<ResolveDecodedDoc<DataModel, DecodedDocs, TableName> | null>
  /** @internal 2-arg form for table-first lookups */
  get(idOrTable: any, maybeId?: any): Promise<any>
  get(idOrTable: any, maybeId?: any): Promise<any> {
    return this.reader.get(idOrTable, maybeId)
  }

  query<TableName extends TableNamesInDataModel<DataModel>>(
    tableName: TableName
  ): ZodvexQueryChain<
    NamedTableInfo<DataModel, TableName>,
    ResolveDecodedDoc<DataModel, DecodedDocs, TableName>
  > {
    return this.reader.query(tableName)
  }

  // --- Write methods: encode before delegating ---

  insert<TableName extends TableNamesInDataModel<DataModel>>(
    table: TableName,
    value: DecodedWriteValue<DataModel, DecodedDocs, TableName>
  ): Promise<GenericId<TableName>>
  /** @internal untyped fallback */
  insert(table: any, value: any): Promise<any>
  async insert(table: any, value: any): Promise<any> {
    const schemas = this.tableMap[table as string]
    const wireValue = schemas ? encodeDoc(schemas.insert, value) : value
    return this.db.insert(table, wireValue)
  }

  patch<TableName extends TableNamesInDataModel<DataModel>>(
    id: GenericId<TableName>,
    value: DecodedPatchValue<DataModel, DecodedDocs, TableName>
  ): Promise<void>
  /** @internal 3-arg form for table-first patches */
  patch(idOrTable: any, idOrValue: any, maybeValue?: any): Promise<void>
  async patch(idOrTable: any, idOrValue: any, maybeValue?: any): Promise<void> {
    let tableName: string | null
    let id: any
    let value: any

    if (maybeValue !== undefined) {
      // patch(table, id, value) form
      tableName = idOrTable
      id = idOrValue
      value = maybeValue
    } else {
      // patch(id, value) form
      id = idOrTable
      value = idOrValue
      tableName = resolveTableName(this.db, this.tableMap, id)
    }

    const schemas = tableName ? this.tableMap[tableName] : undefined
    const wireValue = schemas ? encodePartialDoc(schemas.insert, value) : value

    if (maybeValue !== undefined) {
      // 3-arg form (table, id, value) is @internal in Convex types — cast required
      return (this.db as any).patch(idOrTable, id, wireValue)
    }
    return this.db.patch(id, wireValue)
  }

  replace<TableName extends TableNamesInDataModel<DataModel>>(
    id: GenericId<TableName>,
    value: DecodedWriteValue<DataModel, DecodedDocs, TableName>
  ): Promise<void>
  /** @internal 3-arg form for table-first replaces */
  replace(idOrTable: any, idOrValue: any, maybeValue?: any): Promise<void>
  async replace(idOrTable: any, idOrValue: any, maybeValue?: any): Promise<void> {
    let tableName: string | null
    let id: any
    let value: any

    if (maybeValue !== undefined) {
      tableName = idOrTable
      id = idOrValue
      value = maybeValue
    } else {
      id = idOrTable
      value = idOrValue
      tableName = resolveTableName(this.db, this.tableMap, id)
    }

    const schemas = tableName ? this.tableMap[tableName] : undefined
    const wireValue = schemas ? encodeDoc(schemas.insert, value) : value

    if (maybeValue !== undefined) {
      // 3-arg form (table, id, value) is @internal in Convex types — cast required
      return (this.db as any).replace(idOrTable, id, wireValue)
    }
    return this.db.replace(id, wireValue)
  }

  delete<TableName extends TableNamesInDataModel<DataModel>>(
    id: GenericId<TableName>
  ): Promise<void>
  /** @internal 2-arg form for table-first deletes */
  delete(idOrTable: any, maybeId?: any): Promise<void>
  async delete(idOrTable: any, maybeId?: any): Promise<void> {
    if (maybeId !== undefined) {
      // 2-arg form (table, id) is @internal in Convex types — cast required
      return (this.db as any).delete(idOrTable, maybeId)
    }
    return this.db.delete(idOrTable)
  }

  /**
   * Returns a new ZodvexDatabaseWriter that applies per-table read and write rules.
   * The returned writer is also a ZodvexDatabaseWriter, so `.withRules()` can be chained.
   */
  withRules<Ctx>(
    ctx: Ctx,
    rules: Record<string, any>,
    config?: ZodvexRulesConfig
  ): ZodvexDatabaseWriter<DataModel, DecodedDocs> {
    return getRules().createRulesDatabaseWriter(this, ctx, rules, config)
  }

  /**
   * Returns a new ZodvexDatabaseWriter that fires audit callbacks on reads and writes.
   * The returned writer is also a ZodvexDatabaseWriter, so `.audit()` can be chained
   * with `.withRules()`.
   */
  audit(config: WriterAuditConfig): ZodvexDatabaseWriter<DataModel, DecodedDocs> {
    return getRules().createAuditDatabaseWriter(this, config)
  }
}

/**
 * Creates a ZodvexDatabaseReader from a Convex DatabaseReader and a schema
 * with __zodTableMap (as returned by defineZodSchema).
 *
 * When the schema carries __decodedDocs (from defineZodSchema), DD is inferred
 * automatically, providing decoded types on query terminal methods.
 */
export function createZodDbReader<
  DataModel extends GenericDataModel,
  DD extends Record<string, any> = Record<string, any>
>(
  db: GenericDatabaseReader<DataModel>,
  schema: { __zodTableMap: ZodTableMap; __decodedDocs?: DD }
): ZodvexDatabaseReader<DataModel, DD> {
  return new ZodvexDatabaseReader(db, schema.__zodTableMap) as ZodvexDatabaseReader<DataModel, DD>
}

/**
 * Creates a ZodvexDatabaseWriter from a Convex DatabaseWriter and a schema
 * with __zodTableMap (as returned by defineZodSchema).
 *
 * When the schema carries __decodedDocs (from defineZodSchema), DD is inferred
 * automatically, providing decoded types on query terminal methods.
 */
export function createZodDbWriter<
  DataModel extends GenericDataModel,
  DD extends Record<string, any> = Record<string, any>
>(
  db: GenericDatabaseWriter<DataModel>,
  schema: { __zodTableMap: ZodTableMap; __decodedDocs?: DD }
): ZodvexDatabaseWriter<DataModel, DD> {
  return new ZodvexDatabaseWriter(db, schema.__zodTableMap) as ZodvexDatabaseWriter<DataModel, DD>
}
