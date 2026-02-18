import type {
  GenericTableInfo,
  PaginationOptions,
  PaginationResult,
  QueryInitializer
} from 'convex/server'
import type { z } from 'zod'
import { decodeDoc } from './codec'

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
