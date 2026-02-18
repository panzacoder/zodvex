import type {
  GenericDatabaseReader,
  GenericDatabaseWriter,
  GenericDataModel,
  GenericTableInfo,
  PaginationOptions,
  PaginationResult,
  QueryInitializer,
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
 * Intermediate methods (filter, order, withIndex, etc.) pass through
 * to the inner query — they operate on wire-format data.
 */
export class CodecQueryChain<TableInfo extends GenericTableInfo>
  implements QueryInitializer<TableInfo>
{
  constructor(
    private inner: any,
    private schema: z.ZodTypeAny
  ) {}

  // --- Intermediate methods: pass-through, return wrapped ---

  fullTableScan() {
    return new CodecQueryChain<TableInfo>(this.inner.fullTableScan(), this.schema)
  }

  withIndex(indexName: any, indexRange?: any) {
    return new CodecQueryChain<TableInfo>(this.inner.withIndex(indexName, indexRange), this.schema)
  }

  withSearchIndex(indexName: any, searchFilter: any) {
    return new CodecQueryChain<TableInfo>(
      this.inner.withSearchIndex(indexName, searchFilter),
      this.schema
    )
  }

  order(order: 'asc' | 'desc') {
    return new CodecQueryChain<TableInfo>(this.inner.order(order), this.schema)
  }

  filter(predicate: any): this {
    return new CodecQueryChain<TableInfo>(this.inner.filter(predicate), this.schema) as this
  }

  limit(n: number) {
    return new CodecQueryChain<TableInfo>(this.inner.limit(n), this.schema)
  }

  count(): Promise<number> {
    return this.inner.count()
  }

  // --- Terminal methods: decode at boundary ---

  async first(): Promise<any> {
    const doc = await this.inner.first()
    return doc ? decodeDoc(this.schema, doc) : null
  }

  async unique(): Promise<any> {
    const doc = await this.inner.unique()
    return doc ? decodeDoc(this.schema, doc) : null
  }

  async collect(): Promise<any[]> {
    const docs = await this.inner.collect()
    return docs.map((doc: any) => decodeDoc(this.schema, doc))
  }

  async take(n: number): Promise<any[]> {
    const docs = await this.inner.take(n)
    return docs.map((doc: any) => decodeDoc(this.schema, doc))
  }

  async paginate(paginationOpts: PaginationOptions): Promise<PaginationResult<any>> {
    const result = await this.inner.paginate(paginationOpts)
    return {
      ...result,
      page: result.page.map((doc: any) => decodeDoc(this.schema, doc))
    }
  }

  // --- AsyncIterable: decode each yielded document ---

  async *[Symbol.asyncIterator](): AsyncIterator<any> {
    for await (const doc of this.inner) {
      yield decodeDoc(this.schema, doc)
    }
  }
}

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
 */
export class CodecDatabaseReader<DataModel extends GenericDataModel>
  implements GenericDatabaseReader<DataModel>
{
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

  query(tableName: any): any {
    const schemas = this.tableMap[tableName as string]
    const innerQuery = this.db.query(tableName)
    if (!schemas) return innerQuery
    return new CodecQueryChain(innerQuery, schemas.doc)
  }
}

/**
 * Wraps a GenericDatabaseWriter with automatic Zod codec encoding on writes
 * and decoding on reads. Delegates read operations to a CodecDatabaseReader.
 */
export class CodecDatabaseWriter<DataModel extends GenericDataModel>
  implements GenericDatabaseWriter<DataModel>
{
  private reader: CodecDatabaseReader<DataModel>
  system: GenericDatabaseWriter<DataModel>['system']

  constructor(
    private db: GenericDatabaseWriter<DataModel>,
    private tableMap: ZodTableMap
  ) {
    this.reader = new CodecDatabaseReader(db, tableMap)
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

  query(tableName: any): any {
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
 */
export function createZodDbReader<DataModel extends GenericDataModel>(
  db: GenericDatabaseReader<DataModel>,
  schema: { __zodTableMap: ZodTableMap }
): CodecDatabaseReader<DataModel> {
  return new CodecDatabaseReader(db, schema.__zodTableMap)
}

/**
 * Creates a CodecDatabaseWriter from a Convex DatabaseWriter and a schema
 * with __zodTableMap (as returned by defineZodSchema).
 */
export function createZodDbWriter<DataModel extends GenericDataModel>(
  db: GenericDatabaseWriter<DataModel>,
  schema: { __zodTableMap: ZodTableMap }
): CodecDatabaseWriter<DataModel> {
  return new CodecDatabaseWriter(db, schema.__zodTableMap)
}
