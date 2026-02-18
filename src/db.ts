import type {
  GenericDatabaseReader,
  GenericDataModel,
  GenericTableInfo,
  PaginationOptions,
  PaginationResult,
  QueryInitializer,
  TableNamesInDataModel
} from 'convex/server'
import type { GenericId } from 'convex/values'
import type { z } from 'zod'
import { decodeDoc } from './codec'
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

  filter(predicate: any) {
    return new CodecQueryChain<TableInfo>(this.inner.filter(predicate), this.schema)
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

    const schema = tableName ? this.tableMap[tableName] : undefined
    return schema ? decodeDoc(schema, doc) : doc
  }

  query(tableName: any): any {
    const schema = this.tableMap[tableName as string]
    const innerQuery = this.db.query(tableName)
    if (!schema) return innerQuery
    return new CodecQueryChain(innerQuery, schema)
  }
}
