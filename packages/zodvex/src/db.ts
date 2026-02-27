import type {
  DocumentByInfo,
  ExpressionOrValue,
  FilterBuilder,
  GenericDatabaseReader,
  GenericDatabaseWriter,
  GenericDataModel,
  GenericTableInfo,
  IndexNames,
  IndexRange,
  IndexRangeBuilder,
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
import type { GenericId } from 'convex/values'
import type { z } from 'zod'
import { decodeDoc, encodeDoc, encodePartialDoc } from './codec'
import type { ZodTableMap } from './schema'

/**
 * Wraps a Convex query chain, decoding documents through a Zod schema
 * at terminal methods (first, unique, collect, take, paginate).
 *
 * Two type contexts (dual-generic design):
 * - `TableInfo`: Convex's wire-format table info. Used by intermediate methods
 *   (withIndex, filter, etc.) so IndexRangeBuilder and FilterBuilder see
 *   wire-format field types (e.g., `createdAt: number`).
 * - `Doc`: The decoded/runtime document type. Used by terminal methods
 *   (first, collect, paginate, etc.) so handlers see runtime types
 *   (e.g., `createdAt: Date`).
 *
 * Consumer code never passes these generics manually — they're inferred
 * from CodecDatabaseReader.query() which gets them from defineZodSchema's
 * captured type parameter.
 *
 * Does NOT implement QueryInitializer<TableInfo> because terminal methods
 * return Doc (decoded) instead of DocumentByInfo<TableInfo> (wire).
 */
export class CodecQueryChain<TableInfo extends GenericTableInfo, Doc = DocumentByInfo<TableInfo>> {
  constructor(
    protected inner: any,
    protected schema: z.ZodTypeAny
  ) {}

  /** Factory method for intermediate methods. Subclasses override to return their own type. */
  protected createChain(inner: any): CodecQueryChain<TableInfo, Doc> {
    return new CodecQueryChain(inner, this.schema)
  }

  /** Decode a wire-format doc and cast to the decoded document type. */
  private decode(doc: any): Doc {
    return decodeDoc(this.schema, doc) as Doc
  }

  // --- Intermediate methods: wire-typed TableInfo for Convex machinery ---

  fullTableScan(): CodecQueryChain<TableInfo, Doc> {
    return this.createChain(this.inner.fullTableScan())
  }

  withIndex<IndexName extends IndexNames<TableInfo>>(
    indexName: IndexName,
    indexRange?: (
      q: IndexRangeBuilder<DocumentByInfo<TableInfo>, NamedIndex<TableInfo, IndexName>>
    ) => IndexRange
  ): CodecQueryChain<TableInfo, Doc> {
    return this.createChain(this.inner.withIndex(indexName, indexRange))
  }

  withSearchIndex<IndexName extends SearchIndexNames<TableInfo>>(
    indexName: IndexName,
    searchFilter: (
      q: SearchFilterBuilder<DocumentByInfo<TableInfo>, NamedSearchIndex<TableInfo, IndexName>>
    ) => SearchFilter
  ): CodecQueryChain<TableInfo, Doc> {
    return this.createChain(this.inner.withSearchIndex(indexName, searchFilter))
  }

  order(order: 'asc' | 'desc'): CodecQueryChain<TableInfo, Doc> {
    return this.createChain(this.inner.order(order))
  }

  filter(
    predicate: (q: FilterBuilder<TableInfo>) => ExpressionOrValue<boolean>
  ): CodecQueryChain<TableInfo, Doc> {
    return this.createChain(this.inner.filter(predicate))
  }

  limit(n: number): CodecQueryChain<TableInfo, Doc> {
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
 * accessed at runtime — it only drives the Doc generic on CodecQueryChain
 * so terminal methods return decoded types (e.g., Date instead of number).
 *
 * Does NOT implement GenericDatabaseReader<DataModel> because query() returns
 * CodecQueryChain (with decoded terminal types) instead of QueryInitializer
 * (with wire terminal types).
 */
export class CodecDatabaseReader<
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

  normalizeId<TableName extends TableNamesInDataModel<DataModel>>(
    tableName: TableName,
    id: string
  ): GenericId<TableName> | null {
    return this.db.normalizeId(tableName, id)
  }

  async get(idOrTable: any, maybeId?: any): Promise<any> {
    let tableName: string | null
    let doc: any

    if (maybeId !== undefined) {
      // get(table, id) form
      tableName = idOrTable as string
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
  ): CodecQueryChain<
    NamedTableInfo<DataModel, TableName>,
    ResolveDecodedDoc<DataModel, DecodedDocs, TableName>
  > {
    const schemas = this.tableMap[tableName as string]
    const innerQuery = this.db.query(tableName)
    if (!schemas) {
      // No codec for this table — return unwrapped query.
      // Wire types = runtime types for non-codec tables, and
      // ResolveDecodedDoc falls back to DocumentByInfo (wire) here.
      return innerQuery as any
    }
    return new CodecQueryChain<
      NamedTableInfo<DataModel, TableName>,
      ResolveDecodedDoc<DataModel, DecodedDocs, TableName>
    >(innerQuery, schemas.doc)
  }
}

/**
 * Wraps a GenericDatabaseWriter with automatic Zod codec encoding on writes
 * and decoding on reads. Delegates read operations to a CodecDatabaseReader.
 *
 * Does NOT implement GenericDatabaseWriter<DataModel> because query() returns
 * CodecQueryChain (decoded types) instead of QueryInitializer (wire types).
 */
export class CodecDatabaseWriter<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any> = Record<string, any>
> {
  private reader: CodecDatabaseReader<DataModel, DecodedDocs>
  system: GenericDatabaseWriter<DataModel>['system']

  constructor(
    private db: GenericDatabaseWriter<DataModel>,
    private tableMap: ZodTableMap
  ) {
    // DecodedDocs is phantom — the cast propagates the type through delegation.
    this.reader = new CodecDatabaseReader(db, tableMap) as CodecDatabaseReader<
      DataModel,
      DecodedDocs
    >
    this.system = db.system
  }

  // --- Read methods: delegate to reader ---

  normalizeId<TableName extends TableNamesInDataModel<DataModel>>(
    tableName: TableName,
    id: string
  ): GenericId<TableName> | null {
    return this.reader.normalizeId(tableName, id)
  }

  get(idOrTable: any, maybeId?: any): Promise<any> {
    return this.reader.get(idOrTable, maybeId)
  }

  query<TableName extends TableNamesInDataModel<DataModel>>(
    tableName: TableName
  ): CodecQueryChain<
    NamedTableInfo<DataModel, TableName>,
    ResolveDecodedDoc<DataModel, DecodedDocs, TableName>
  > {
    return this.reader.query(tableName)
  }

  // --- Write methods: encode before delegating ---

  async insert(table: any, value: any): Promise<any> {
    const schemas = this.tableMap[table as string]
    const wireValue = schemas ? encodeDoc(schemas.insert, value) : value
    return this.db.insert(table, wireValue)
  }

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

  async delete(idOrTable: any, maybeId?: any): Promise<void> {
    if (maybeId !== undefined) {
      // 2-arg form (table, id) is @internal in Convex types — cast required
      return (this.db as any).delete(idOrTable, maybeId)
    }
    return this.db.delete(idOrTable)
  }
}

/**
 * Creates a CodecDatabaseReader from a Convex DatabaseReader and a schema
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
): CodecDatabaseReader<DataModel, DD> {
  return new CodecDatabaseReader(db, schema.__zodTableMap) as CodecDatabaseReader<DataModel, DD>
}

/**
 * Creates a CodecDatabaseWriter from a Convex DatabaseWriter and a schema
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
): CodecDatabaseWriter<DataModel, DD> {
  return new CodecDatabaseWriter(db, schema.__zodTableMap) as CodecDatabaseWriter<DataModel, DD>
}
