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
import type { ZodTableMap } from './schema'
import { $ZodObject, $ZodType, $ZodUnion, encode } from './zod-core'

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
function encodeIndexValue(schema: $ZodType, fieldPath: string, value: any): any {
  // Dot-paths target wire-format sub-fields — value is already correct
  if (fieldPath.includes('.')) return value

  // Object schemas: encode through the field's schema directly
  if (schema instanceof $ZodObject) {
    const fieldSchema = (schema as z.ZodObject<any>).shape[fieldPath] // zod-ok
    if (fieldSchema) return encode(fieldSchema, value)
  }

  // Union schemas (ZodDiscriminatedUnion extends ZodUnion): build a per-field
  // union from all variants, then encode through that. Handles discriminator
  // literals and codec fields (e.g., zx.date()) correctly.
  // Non-object variants are skipped — union tables require object variants.
  if (schema instanceof $ZodUnion) {
    const options = schema._zod.def.options
    const fieldSchemas = options
      .filter((v): v is z.ZodObject<any> => v instanceof $ZodObject) // zod-ok
      .map(v => v.shape[fieldPath])
      .filter(Boolean)
    if (fieldSchemas.length === 1) return encode(fieldSchemas[0], value)
    if (fieldSchemas.length > 1)
      return encode(z.union(fieldSchemas as [$ZodType, $ZodType, ...$ZodType[]]), value)
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
function wrapIndexRangeBuilder(inner: any, schema: $ZodType): any {
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

function isFilterExpression(value: any, expressionPrototype: object): boolean {
  return value != null && Object.prototype.isPrototypeOf.call(expressionPrototype, value)
}

function extractFieldPath(expr: any, expressionPrototype: object): string | null {
  if (isFilterExpression(expr, expressionPrototype)) {
    const inner = expr.serialize()
    if (inner && typeof inner === 'object' && '$field' in inner) {
      return inner.$field
    }
  }
  return null
}

function wrapFilterBuilder(inner: any, schema: $ZodType): any {
  // Use the builder's own expression type, including expressions created outside
  // this wrapper. A codec's runtime value may also have a serialize() method.
  const expressionPrototype = Object.getPrototypeOf(inner.field('_id'))
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && ['eq', 'neq', 'lt', 'lte', 'gt', 'gte'].includes(prop)) {
        return (l: any, r: any) => {
          const lField = extractFieldPath(l, expressionPrototype)
          const rField = extractFieldPath(r, expressionPrototype)
          if (lField && !isFilterExpression(r, expressionPrototype)) {
            r = encodeIndexValue(schema, lField, r)
          } else if (rField && !isFilterExpression(l, expressionPrototype)) {
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
    protected schema: $ZodType
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
export type ResolveDecodedDoc<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>,
  TableName extends TableNamesInDataModel<DataModel>
> = TableName extends keyof DecodedDocs
  ? DecodedDocs[TableName]
  : DocumentByInfo<NamedTableInfo<DataModel, TableName>>

/** System fields auto-managed by Convex — not writable by consumers. */
type SystemFields = '_id' | '_creationTime'

/** Preserve variant fields, including named fields alongside a string index signature. */
type WithoutSystemFields<Doc> = Doc extends unknown
  ? { [Key in keyof Doc as Key extends SystemFields ? never : Key]: Doc[Key] }
  : never

/** Value accepted by insert and replace: decoded document without Convex-managed fields. */
export type WriteValue<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>,
  TableName extends TableNamesInDataModel<DataModel>
> = WithoutSystemFields<ResolveDecodedDoc<DataModel, DecodedDocs, TableName>>

/** Check the whole document against each member without collapsing variant fields. */
type IsUnion<Doc, Whole = Doc> = Doc extends unknown
  ? [Whole] extends [Doc]
    ? false
    : true
  : never

/** Known decoded unions use full encoding; ordinary object documents accept partials. */
type ModeledPatchValue<Doc> =
  true extends IsUnion<Doc> ? WithoutSystemFields<Doc> : Partial<WithoutSystemFields<Doc>>

/**
 * Value accepted by patch: partial decoded object without Convex-managed fields.
 * Union patches need a complete variant because encodePartialDoc uses full encoding.
 * Only decoded output types are available here: erased/collapsed schema unions cannot
 * be detected, and runtime encoding remains authoritative. Unmodeled tables retain
 * native partial patch values.
 */
export type PatchValue<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>,
  TableName extends TableNamesInDataModel<DataModel>
> = TableName extends keyof DecodedDocs
  ? ModeledPatchValue<DecodedDocs[TableName]>
  : Partial<WithoutSystemFields<ResolveDecodedDoc<DataModel, DecodedDocs, TableName>>>

/** Compatibility aliases for the originally published names. */
export type { PatchValue as ZodvexPatchValue, WriteValue as ZodvexWriteValue }

/**
 * Resolves a table name from a GenericId by iterating the tableMap
 * and calling normalizeId.
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

  /** @internal Expose for wrapper construction (rule/audit subclasses) */
  get _internals(): { db: GenericDatabaseReader<DataModel>; tableMap: ZodTableMap } {
    return { db: this.db, tableMap: this.tableMap }
  }

  /**
   * Escape hatch (#85/#92): returns the database this codec wrapper delegates
   * to — the composed underlying stack when `underlyingDb` is configured (e.g.
   * a trigger-wrapped writer), the bare Convex db otherwise.
   *
   * The returned db is native-shape: reads are undecoded wire documents and it
   * bypasses codec, `.withRules()`, and `.audit()` layers entirely.
   */
  unwrap(): GenericDatabaseReader<DataModel> {
    return this.db
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
  get<TableName extends TableNamesInDataModel<DataModel>>(
    table: TableName,
    id: GenericId<NoInfer<TableName>>
  ): Promise<ResolveDecodedDoc<DataModel, DecodedDocs, TableName> | null>
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
    return new RulesDatabaseReader(this, ctx, rules, config ?? {})
  }

  /**
   * Returns a new ZodvexDatabaseReader that fires audit callbacks on reads.
   * The returned reader is also a ZodvexDatabaseReader, so `.audit()` can be chained
   * with `.withRules()`.
   */
  audit(config: ReaderAuditConfig): ZodvexDatabaseReader<DataModel, DecodedDocs> {
    return new AuditDatabaseReader(this, config)
  }
}

/**
 * Wraps a GenericDatabaseWriter with automatic Zod codec encoding on writes
 * and decoding on reads. Inherits read methods from ZodvexDatabaseReader so
 * that `ZodvexDatabaseWriter` narrows to `ZodvexDatabaseReader` at call sites
 * — the native Convex `MutationCtx → QueryCtx` idiom (#64).
 *
 * Does NOT implement GenericDatabaseWriter<DataModel> because query() returns
 * ZodvexQueryChain (decoded types) instead of QueryInitializer (wire types).
 */
export class ZodvexDatabaseWriter<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any> = Record<string, any>
> extends ZodvexDatabaseReader<DataModel, DecodedDocs> {
  // Narrows the inherited `protected db` to the writer-typed view without
  // shadowing the underlying instance. Used by the write methods below.
  protected get writerDb(): GenericDatabaseWriter<DataModel> {
    return this.db as GenericDatabaseWriter<DataModel>
  }

  declare system: GenericDatabaseWriter<DataModel>['system']

  constructor(db: GenericDatabaseWriter<DataModel>, tableMap: ZodTableMap) {
    super(db, tableMap)
    this.system = db.system
  }

  /**
   * @internal Expose writer-typed internals for rules / audit subclasses.
   * Includes a `reader` field that aliases `this` (writer IS-A reader after
   * the #64 refactor) so callers expecting `_internals.reader` still work.
   */
  override get _internals(): {
    db: GenericDatabaseWriter<DataModel>
    tableMap: ZodTableMap
    reader: ZodvexDatabaseReader<DataModel, DecodedDocs>
  } {
    return { db: this.writerDb, tableMap: this.tableMap, reader: this }
  }

  /**
   * Escape hatch (#85/#92): returns the writer this codec wrapper delegates
   * to — the composed underlying stack when `underlyingDb` is configured (e.g.
   * a trigger-wrapped writer), the bare Convex db otherwise.
   *
   * The returned db is native-shape: writes must be wire-format and it
   * bypasses codec, `.withRules()`, and `.audit()` layers entirely.
   */
  override unwrap(): GenericDatabaseWriter<DataModel> {
    return this.writerDb
  }

  // --- Write methods: encode before delegating ---

  insert<TableName extends TableNamesInDataModel<DataModel>>(
    table: TableName,
    value: WriteValue<DataModel, DecodedDocs, NoInfer<TableName>>
  ): Promise<GenericId<TableName>>
  async insert(table: any, value: any): Promise<any> {
    const schemas = this.tableMap[table as string]
    const wireValue = schemas ? encodeDoc(schemas.insert, value) : value
    return this.writerDb.insert(table, wireValue)
  }

  patch<TableName extends TableNamesInDataModel<DataModel>>(
    id: GenericId<TableName>,
    value: PatchValue<DataModel, DecodedDocs, NoInfer<TableName>>
  ): Promise<void>
  patch<TableName extends TableNamesInDataModel<DataModel>>(
    table: TableName,
    id: GenericId<NoInfer<TableName>>,
    value: PatchValue<DataModel, DecodedDocs, NoInfer<TableName>>
  ): Promise<void>
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
      return (this.writerDb as any).patch(idOrTable, id, wireValue)
    }
    return this.writerDb.patch(id, wireValue)
  }

  replace<TableName extends TableNamesInDataModel<DataModel>>(
    id: GenericId<TableName>,
    value: WriteValue<DataModel, DecodedDocs, NoInfer<TableName>>
  ): Promise<void>
  replace<TableName extends TableNamesInDataModel<DataModel>>(
    table: TableName,
    id: GenericId<NoInfer<TableName>>,
    value: WriteValue<DataModel, DecodedDocs, NoInfer<TableName>>
  ): Promise<void>
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
      return (this.writerDb as any).replace(idOrTable, id, wireValue)
    }
    return this.writerDb.replace(id, wireValue)
  }

  delete<TableName extends TableNamesInDataModel<DataModel>>(
    id: GenericId<TableName>
  ): Promise<void>
  delete<TableName extends TableNamesInDataModel<DataModel>>(
    table: TableName,
    id: GenericId<NoInfer<TableName>>
  ): Promise<void>
  async delete(idOrTable: any, maybeId?: any): Promise<void> {
    if (maybeId !== undefined) {
      // 2-arg form (table, id) is @internal in Convex types — cast required
      return (this.writerDb as any).delete(idOrTable, maybeId)
    }
    return this.writerDb.delete(idOrTable)
  }

  /**
   * Returns a new ZodvexDatabaseWriter that applies per-table read and write rules.
   * The returned writer is also a ZodvexDatabaseWriter, so `.withRules()` can be chained.
   *
   * Overrides Reader's signature so a writer chained call returns a writer.
   */
  override withRules<Ctx>(
    ctx: Ctx,
    rules: Record<string, any>,
    config?: ZodvexRulesConfig
  ): ZodvexDatabaseWriter<DataModel, DecodedDocs> {
    return new RulesDatabaseWriter(this, ctx, rules, config ?? {})
  }

  /**
   * Returns a new ZodvexDatabaseWriter that fires audit callbacks on reads and writes.
   * The returned writer is also a ZodvexDatabaseWriter, so `.audit()` can be chained
   * with `.withRules()`.
   *
   * Overrides Reader's signature so a writer chained call returns a writer.
   */
  override audit(config: WriterAuditConfig): ZodvexDatabaseWriter<DataModel, DecodedDocs> {
    return new AuditDatabaseWriter(this, config)
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

/**
 * Per-document rule function. Gates and optionally transforms documents.
 * Return true to allow unchanged, false/null to deny, or Doc to transform.
 * Boolean shorthand keeps simple RLS rules concise.
 */
export type ReadRule<Ctx, Doc> = (ctx: Ctx, doc: Doc) => Promise<Doc | null | boolean>

/** Convenience type: insert doc is the decoded doc without system fields. */
export type InsertDoc<Doc> = Omit<Doc, '_id' | '_creationTime'>

/**
 * Per-insert rule. Gates and optionally transforms the insert value.
 * Return the value (possibly transformed) to allow. Throw to deny.
 */
export type InsertRule<Ctx, Doc> = (ctx: Ctx, value: InsertDoc<Doc>) => Promise<InsertDoc<Doc>>

/**
 * Per-patch rule. Receives current doc + patch value.
 * Return the patch value (possibly transformed) to allow. Throw to deny.
 */
export type PatchRule<Ctx, Doc> = (ctx: Ctx, doc: Doc, value: Partial<Doc>) => Promise<Partial<Doc>>

/**
 * Per-replace rule. Receives current doc + full replacement value.
 * Return the replacement (possibly transformed) to allow. Throw to deny.
 */
export type ReplaceRule<Ctx, Doc> = (ctx: Ctx, doc: Doc, value: Doc) => Promise<Doc>

/**
 * Per-delete rule. Receives current doc. Throw to deny.
 */
export type DeleteRule<Ctx, Doc> = (ctx: Ctx, doc: Doc) => Promise<void>

/**
 * Rules for a single table, organized by database operation.
 */
export type TableRules<Ctx, Doc> = {
  read?: ReadRule<Ctx, Doc>
  insert?: InsertRule<Ctx, Doc>
  patch?: PatchRule<Ctx, Doc>
  replace?: ReplaceRule<Ctx, Doc>
  delete?: DeleteRule<Ctx, Doc>
}

/**
 * Per-table rules for all tables in the data model.
 * With defaultPolicy: 'deny', ALL tables are denied by default (including unmentioned ones).
 * With defaultPolicy: 'allow' (default), unmentioned tables pass through.
 */
export type ZodvexRules<
  Ctx,
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>
> = {
  [T in TableNamesInDataModel<DataModel>]?: TableRules<
    Ctx,
    ResolveDecodedDocForRules<DataModel, DecodedDocs, T>
  >
}

/**
 * Resolves the decoded doc type for a table. Mirrors ResolveDecodedDoc from db.ts
 * but exported for consumer use in rule definitions.
 */
export type ResolveDecodedDocForRules<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>,
  TableName extends TableNamesInDataModel<DataModel>
> = TableName extends keyof DecodedDocs ? DecodedDocs[TableName] : any

/**
 * Configuration for .withRules().
 */
export type ZodvexRulesConfig = {
  /** Default policy for all operations. 'deny' applies to ALL tables including unmentioned ones. Default: 'allow'. */
  defaultPolicy?: 'allow' | 'deny'
  /** Allow count() when rules are present. Default: false. */
  allowCounting?: boolean
}

/**
 * Describes a completed write operation for audit callbacks.
 * Generic over Doc so audit events carry decoded types.
 * Default `any` for untyped usage.
 */
export type WriteEvent<Doc = any> =
  | { type: 'insert'; id: GenericId<any>; value: InsertDoc<Doc> }
  | { type: 'patch'; id: GenericId<any>; doc: Doc; value: Partial<Doc> }
  | { type: 'replace'; id: GenericId<any>; doc: Doc; value: Doc }
  | { type: 'delete'; id: GenericId<any>; doc: Doc }

/**
 * Audit configuration for .audit() on a reader.
 */
export type ReaderAuditConfig = {
  afterRead?: (table: string, doc: any) => void | Promise<void>
}

/**
 * Audit configuration for .audit() on a writer.
 * Generic over DataModel and DecodedDocs so afterWrite events carry decoded types.
 */
export type WriterAuditConfig<
  DataModel extends GenericDataModel = GenericDataModel,
  DecodedDocs extends Record<string, any> = Record<string, any>
> = {
  afterRead?: (table: string, doc: any) => void | Promise<void>
  afterWrite?: <T extends TableNamesInDataModel<DataModel>>(
    table: T,
    event: WriteEvent<ResolveDecodedDocForRules<DataModel, DecodedDocs, T>>
  ) => void | Promise<void>
}

/**
 * Normalize a read rule result: true -> doc (pass-through), false/null -> null (deny), Doc -> Doc (transform).
 */
export function normalizeReadResult<Doc>(
  result: Doc | null | boolean,
  originalDoc: Doc
): Doc | null {
  if (result === true) return originalDoc
  if (result === false) return null
  return result
}

/**
 * Extends ZodvexQueryChain, applying a read rule at every terminal method.
 * Intermediate methods are inherited from the base class via createChain().
 * Only terminals and createChain() are overridden.
 */
export class RulesQueryChain<TableInfo extends GenericTableInfo, Doc> extends ZodvexQueryChain<
  TableInfo,
  Doc
> {
  private readRule: ReadRule<any, Doc>
  private rulesConfig: ZodvexRulesConfig
  private ctx: any

  constructor(
    inner: any,
    schema: any,
    readRule: ReadRule<any, Doc>,
    config: ZodvexRulesConfig,
    ctx: any = {}
  ) {
    super(inner, schema)
    this.readRule = readRule
    this.rulesConfig = config
    this.ctx = ctx
  }

  protected createChain(inner: any): RulesQueryChain<TableInfo, Doc> {
    return new RulesQueryChain(
      inner,
      (this as any).schema,
      this.readRule,
      this.rulesConfig,
      this.ctx
    )
  }

  async first(): Promise<Doc | null> {
    for await (const doc of this as any) {
      return doc
    }
    return null
  }

  async unique(): Promise<Doc | null> {
    const doc = await super.unique()
    if (doc === null) return null
    return normalizeReadResult(await this.readRule(this.ctx, doc), doc)
  }

  async collect(): Promise<Doc[]> {
    const results: Doc[] = []
    for await (const doc of this as any) {
      results.push(doc)
    }
    return results
  }

  async take(n: number): Promise<Doc[]> {
    if (!Number.isInteger(n) || n < 0) {
      throw new Error('take requires a non-negative integer')
    }
    const results: Doc[] = []
    if (n === 0) return results
    for await (const doc of this as any) {
      results.push(doc)
      if (results.length >= n) break
    }
    return results
  }

  async paginate(opts: PaginationOptions): Promise<PaginationResult<Doc>> {
    const result = await super.paginate(opts)
    const filtered: Doc[] = []
    for (const doc of result.page) {
      const allowed = normalizeReadResult(await this.readRule(this.ctx, doc), doc)
      if (allowed !== null) filtered.push(allowed)
    }
    return { ...result, page: filtered }
  }

  async count(): Promise<number> {
    if (!this.rulesConfig.allowCounting) {
      throw new Error('count is not allowed with rules')
    }
    return super.count()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Doc> {
    // The base method is an async generator; its public type exposes only AsyncIterator.
    for await (const value of super[Symbol.asyncIterator]() as AsyncIterableIterator<Doc>) {
      const result = normalizeReadResult(await this.readRule(this.ctx, value), value)
      if (result !== null) yield result
    }
  }
}

/**
 * Wraps a ZodvexDatabaseReader with per-table read rules.
 */
class RulesDatabaseReader<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>
> extends ZodvexDatabaseReader<DataModel, DecodedDocs> {
  constructor(
    private inner: ZodvexDatabaseReader<DataModel, DecodedDocs>,
    private ctx: any,
    private rules: Record<string, TableRules<any, any>>,
    private rulesConfig: ZodvexRulesConfig
  ) {
    const { db, tableMap } = (inner as any)._internals
    super(db, tableMap)
    ;(this as any).system = (inner as any).system
  }

  async get(idOrTable: any, maybeId?: any): Promise<any> {
    const doc = await this.inner.get(idOrTable, maybeId)
    if (doc === null) return null

    const tableName =
      maybeId !== undefined ? (idOrTable as string) : this.resolveTableFromId(idOrTable)

    if (!tableName) return doc
    return this.applyReadRule(tableName, doc)
  }

  query<TableName extends TableNamesInDataModel<DataModel>>(tableName: TableName): any {
    const tableRules = this.rules[tableName as string]

    if (!tableRules?.read && (this.rulesConfig.defaultPolicy ?? 'allow') === 'allow') {
      return this.inner.query(tableName)
    }

    const innerChain = this.inner.query(tableName)
    const readRule = tableRules?.read ?? (async () => null)
    const passthroughSchema = z.any()
    return new RulesQueryChain(innerChain, passthroughSchema, readRule, this.rulesConfig, this.ctx)
  }

  private resolveTableFromId(id: any): string | null {
    for (const tableName of Object.keys(this.rules)) {
      if (this.inner.normalizeId(tableName as any, id as unknown as string)) {
        return tableName
      }
    }
    if ((this.rulesConfig.defaultPolicy ?? 'allow') === 'deny') {
      for (const tableName of Object.keys((this.inner as any)._internals.tableMap)) {
        if (this.inner.normalizeId(tableName as any, id as unknown as string)) {
          return tableName
        }
      }
    }
    return null
  }

  private async applyReadRule(tableName: string, doc: any): Promise<any> {
    const tableRules = this.rules[tableName]
    if (!tableRules?.read) {
      if ((this.rulesConfig.defaultPolicy ?? 'allow') === 'deny') return null
      return doc
    }
    const result = await tableRules.read(this.ctx, doc)
    return normalizeReadResult(result, doc)
  }
}

/**
 * Wraps a ZodvexDatabaseWriter with per-table read and write rules.
 */
class RulesDatabaseWriter<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>
> extends ZodvexDatabaseWriter<DataModel, DecodedDocs> {
  private rulesReader: ZodvexDatabaseReader<DataModel, DecodedDocs>

  constructor(
    private inner: ZodvexDatabaseWriter<DataModel, DecodedDocs>,
    private ctx: any,
    private rules: Record<string, TableRules<any, any>>,
    private rulesConfig: ZodvexRulesConfig
  ) {
    const { db, tableMap, reader: innerReader } = (inner as any)._internals
    super(db, tableMap)
    this.rulesReader = new RulesDatabaseReader(innerReader, ctx, rules, rulesConfig) as any
    ;(this as any).system = (inner as any).system
  }

  normalizeId<TableName extends TableNamesInDataModel<DataModel>>(
    tableName: TableName,
    id: string
  ): GenericId<TableName> | null {
    return this.rulesReader.normalizeId(tableName, id)
  }

  async get(idOrTable: any, maybeId?: any): Promise<any> {
    return this.rulesReader.get(idOrTable, maybeId)
  }

  query<TableName extends TableNamesInDataModel<DataModel>>(tableName: TableName): any {
    return this.rulesReader.query(tableName)
  }

  async insert(table: any, value: any): Promise<any> {
    const tableName = table as string
    const tableRules = this.rules[tableName]

    if (tableRules?.insert) {
      const transformed = await tableRules.insert(this.ctx, value)
      // Rules are stored with erased table types; the codec boundary validates
      // the transformed document against this table's insert schema.
      return this.inner.insert(
        table,
        transformed as Parameters<ZodvexDatabaseWriter<DataModel, DecodedDocs>['insert']>[1]
      )
    }

    if ((this.rulesConfig.defaultPolicy ?? 'allow') === 'deny') {
      throw new Error(`insert not allowed on ${tableName}`)
    }

    return this.inner.insert(table, value)
  }

  async patch(idOrTable: any, idOrValue: any, maybeValue?: any): Promise<void> {
    let id: any
    let value: any

    if (maybeValue !== undefined) {
      id = idOrValue
      value = maybeValue
    } else {
      id = idOrTable
      value = idOrValue
    }

    const doc = await this.rulesReader.get(id)
    if (doc === null) {
      throw new Error('no read access or doc does not exist')
    }

    const tableName = this.resolveTableFromId(id)
    const tableRules = tableName ? this.rules[tableName] : undefined

    if (tableRules?.patch) {
      const transformed = await tableRules.patch(this.ctx, doc, value)
      // Rules erase table types; the inner encoder still validates transformed
      // patches, including the complete-variant requirement for union schemas.
      return this.inner.patch(
        id,
        transformed as Parameters<ZodvexDatabaseWriter<DataModel, DecodedDocs>['patch']>[2]
      )
    }

    if ((this.rulesConfig.defaultPolicy ?? 'allow') === 'deny') {
      throw new Error(`patch not allowed on ${tableName}`)
    }

    return this.inner.patch(id, value)
  }

  async replace(idOrTable: any, idOrValue: any, maybeValue?: any): Promise<void> {
    let id: any
    let value: any

    if (maybeValue !== undefined) {
      id = idOrValue
      value = maybeValue
    } else {
      id = idOrTable
      value = idOrValue
    }

    const doc = await this.rulesReader.get(id)
    if (doc === null) {
      throw new Error('no read access or doc does not exist')
    }

    const tableName = this.resolveTableFromId(id)
    const tableRules = tableName ? this.rules[tableName] : undefined

    if (tableRules?.replace) {
      const transformed = await tableRules.replace(this.ctx, doc, value)
      return this.inner.replace(id, transformed)
    }

    if ((this.rulesConfig.defaultPolicy ?? 'allow') === 'deny') {
      throw new Error(`replace not allowed on ${tableName}`)
    }

    return this.inner.replace(id, value)
  }

  async delete(idOrTable: any, maybeId?: any): Promise<void> {
    let id: any

    if (maybeId !== undefined) {
      id = maybeId
    } else {
      id = idOrTable
    }

    const doc = await this.rulesReader.get(id)
    if (doc === null) {
      throw new Error('no read access or doc does not exist')
    }

    const tableName = this.resolveTableFromId(id)
    const tableRules = tableName ? this.rules[tableName] : undefined

    if (tableRules?.delete) {
      await tableRules.delete(this.ctx, doc)
      return this.inner.delete(id)
    }

    if ((this.rulesConfig.defaultPolicy ?? 'allow') === 'deny') {
      throw new Error(`delete not allowed on ${tableName}`)
    }

    return this.inner.delete(id)
  }

  private resolveTableFromId(id: any): string | null {
    for (const tableName of Object.keys(this.rules)) {
      if (this.inner.normalizeId(tableName as any, id as unknown as string)) {
        return tableName
      }
    }
    if ((this.rulesConfig.defaultPolicy ?? 'allow') === 'deny') {
      for (const tableName of Object.keys((this.inner as any)._internals.tableMap)) {
        if (this.inner.normalizeId(tableName as any, id as unknown as string)) {
          return tableName
        }
      }
    }
    return null
  }
}

// ==========================================================================
// Audit wrapping — afterRead and afterWrite callbacks
// ==========================================================================

/**
 * Extends ZodvexQueryChain to fire an afterRead callback for each document
 * returned by terminal methods.
 */
class AuditQueryChain<TableInfo extends GenericTableInfo, Doc> extends ZodvexQueryChain<
  TableInfo,
  Doc
> {
  private afterRead: (table: string, doc: any) => void | Promise<void>
  private tableName: string

  constructor(
    inner: any,
    schema: any,
    afterRead: (table: string, doc: any) => void | Promise<void>,
    tableName: string
  ) {
    super(inner, schema)
    this.afterRead = afterRead
    this.tableName = tableName
  }

  protected createChain(inner: any): AuditQueryChain<TableInfo, Doc> {
    return new AuditQueryChain(inner, (this as any).schema, this.afterRead, this.tableName)
  }

  async first(): Promise<Doc | null> {
    const doc = await super.first()
    if (doc !== null) await this.afterRead(this.tableName, doc)
    return doc
  }

  async unique(): Promise<Doc | null> {
    const doc = await super.unique()
    if (doc !== null) await this.afterRead(this.tableName, doc)
    return doc
  }

  async collect(): Promise<Doc[]> {
    const docs = await super.collect()
    for (const doc of docs) {
      await this.afterRead(this.tableName, doc)
    }
    return docs
  }

  async take(n: number): Promise<Doc[]> {
    const docs = await super.take(n)
    for (const doc of docs) {
      await this.afterRead(this.tableName, doc)
    }
    return docs
  }

  async paginate(opts: PaginationOptions): Promise<PaginationResult<Doc>> {
    const result = await super.paginate(opts)
    for (const doc of result.page) {
      await this.afterRead(this.tableName, doc)
    }
    return result
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Doc> {
    // The base method is an async generator; its public type exposes only AsyncIterator.
    for await (const value of super[Symbol.asyncIterator]() as AsyncIterableIterator<Doc>) {
      await this.afterRead(this.tableName, value)
      yield value
    }
  }
}

/**
 * Wraps a ZodvexDatabaseReader with afterRead audit callbacks.
 */
class AuditDatabaseReader<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>
> extends ZodvexDatabaseReader<DataModel, DecodedDocs> {
  private inner: ZodvexDatabaseReader<DataModel, DecodedDocs>
  private afterRead: (table: string, doc: any) => void | Promise<void>

  constructor(inner: ZodvexDatabaseReader<DataModel, DecodedDocs>, config: ReaderAuditConfig) {
    const { db, tableMap } = (inner as any)._internals
    super(db, tableMap)
    this.inner = inner
    this.afterRead =
      config.afterRead ??
      (() => {
        /* noop */
      })
    ;(this as any).system = (inner as any).system
  }

  async get(idOrTable: any, maybeId?: any): Promise<any> {
    const doc = await this.inner.get(idOrTable, maybeId)
    if (doc !== null) {
      const tableName = this.resolveTableFromId(
        maybeId !== undefined ? maybeId : idOrTable,
        maybeId !== undefined ? idOrTable : undefined
      )
      if (tableName) {
        await this.afterRead(tableName, doc)
      }
    }
    return doc
  }

  query<TableName extends TableNamesInDataModel<DataModel>>(tableName: TableName): any {
    const innerChain = this.inner.query(tableName)
    const passthroughSchema = z.any()
    return new AuditQueryChain(innerChain, passthroughSchema, this.afterRead, tableName as string)
  }

  private resolveTableFromId(id: any, explicitTable?: string): string | null {
    if (explicitTable) return explicitTable
    for (const tableName of Object.keys((this as any).tableMap)) {
      if (this.inner.normalizeId(tableName as any, id as unknown as string)) {
        return tableName
      }
    }
    return null
  }
}

/**
 * Wraps a ZodvexDatabaseWriter with afterRead and afterWrite audit callbacks.
 */
class AuditDatabaseWriter<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>
> extends ZodvexDatabaseWriter<DataModel, DecodedDocs> {
  private inner: ZodvexDatabaseWriter<DataModel, DecodedDocs>
  private auditReader: ZodvexDatabaseReader<DataModel, DecodedDocs>
  private afterWrite: ((table: string, event: WriteEvent) => void | Promise<void>) | undefined

  constructor(inner: ZodvexDatabaseWriter<DataModel, DecodedDocs>, config: WriterAuditConfig) {
    const { db, tableMap, reader: innerReader } = (inner as any)._internals
    super(db, tableMap)
    this.inner = inner
    this.afterWrite = config.afterWrite as typeof this.afterWrite

    this.auditReader = config.afterRead
      ? (new AuditDatabaseReader(innerReader, { afterRead: config.afterRead }) as any)
      : innerReader
    ;(this as any).system = (inner as any).system
  }

  normalizeId<TableName extends TableNamesInDataModel<DataModel>>(
    tableName: TableName,
    id: string
  ): GenericId<TableName> | null {
    return this.auditReader.normalizeId(tableName, id)
  }

  async get(idOrTable: any, maybeId?: any): Promise<any> {
    return this.auditReader.get(idOrTable, maybeId)
  }

  query<TableName extends TableNamesInDataModel<DataModel>>(tableName: TableName): any {
    return this.auditReader.query(tableName)
  }

  async insert(table: any, value: any): Promise<any> {
    const id = await this.inner.insert(table, value)
    if (this.afterWrite) {
      await this.afterWrite(table as string, { type: 'insert', id, value })
    }
    return id
  }

  async patch(idOrTable: any, idOrValue: any, maybeValue?: any): Promise<void> {
    let id: any
    let value: any

    if (maybeValue !== undefined) {
      id = idOrValue
      value = maybeValue
    } else {
      id = idOrTable
      value = idOrValue
    }

    const doc = await this.inner.get(id)

    if (maybeValue !== undefined) {
      await this.inner.patch(idOrTable, idOrValue, maybeValue)
    } else {
      await this.inner.patch(id, value)
    }

    if (this.afterWrite) {
      const tableName = this.resolveTableFromId(id)
      if (tableName) {
        await this.afterWrite(tableName, { type: 'patch', id, doc, value })
      }
    }
  }

  async replace(idOrTable: any, idOrValue: any, maybeValue?: any): Promise<void> {
    let id: any
    let value: any

    if (maybeValue !== undefined) {
      id = idOrValue
      value = maybeValue
    } else {
      id = idOrTable
      value = idOrValue
    }

    const doc = await this.inner.get(id)

    if (maybeValue !== undefined) {
      await this.inner.replace(idOrTable, idOrValue, maybeValue)
    } else {
      await this.inner.replace(id, value)
    }

    if (this.afterWrite) {
      const tableName = this.resolveTableFromId(id)
      if (tableName) {
        await this.afterWrite(tableName, { type: 'replace', id, doc, value })
      }
    }
  }

  async delete(idOrTable: any, maybeId?: any): Promise<void> {
    let id: any

    if (maybeId !== undefined) {
      id = maybeId
    } else {
      id = idOrTable
    }

    const doc = await this.inner.get(id)

    if (maybeId !== undefined) {
      await this.inner.delete(idOrTable, maybeId)
    } else {
      await this.inner.delete(id)
    }

    if (this.afterWrite) {
      const tableName = this.resolveTableFromId(id)
      if (tableName) {
        await this.afterWrite(tableName, { type: 'delete', id, doc })
      }
    }
  }

  private resolveTableFromId(id: any): string | null {
    for (const tableName of Object.keys((this.inner as any)._internals.tableMap)) {
      if (this.inner.normalizeId(tableName as any, id as unknown as string)) {
        return tableName
      }
    }
    return null
  }
}
