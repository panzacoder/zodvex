import type { PaginationOptions, PaginationResult } from 'convex/server'
import { decodeDoc } from './codec'
import type { $ZodType } from './zod-core'

export type ReadLayer<Doc = any> =
  | { kind: 'decode'; schema: $ZodType }
  | {
      kind: 'rules'
      read: (doc: Doc) => Doc | boolean | null | Promise<Doc | boolean | null>
      allowCounting?: boolean
    }
  | { kind: 'audit'; afterRead: (doc: Doc) => void | Promise<void> }

export function normalizeReadResult<Doc>(result: Doc | null | boolean, original: Doc): Doc | null {
  if (result === true) return original
  if (result === false) return null
  return result
}

/** Shared by native single-document lookup and query execution. */
export async function processRead<Doc>(layer: ReadLayer<Doc>, doc: Doc): Promise<Doc | null> {
  switch (layer.kind) {
    case 'decode':
      return decodeDoc(layer.schema, doc) as Doc
    case 'rules':
      return normalizeReadResult<Doc>(await layer.read(doc), doc)
    case 'audit':
      await layer.afterRead(doc)
      return doc
  }
}

// A plan can cross entrypoint bundles. Do not recognize it by class identity.
const planKey = Symbol.for('zodvex.readQuery.plan')

interface QuerySource<Doc> extends AsyncIterable<Doc> {
  first(): Promise<Doc | null>
  unique(): Promise<Doc | null>
  collect(): Promise<Doc[]>
  take(n: number): Promise<Doc[]>
  paginate(opts: PaginationOptions): Promise<PaginationResult<Doc>>
  count(): Promise<number>
  fullTableScan(): QuerySource<Doc>
  withIndex(...args: any[]): QuerySource<Doc>
  withSearchIndex(...args: any[]): QuerySource<Doc>
  order(...args: any[]): QuerySource<Doc>
  filter(...args: any[]): QuerySource<Doc>
  limit(n: number): QuerySource<Doc>
}

interface ReadPlan<Doc> {
  source: QuerySource<Doc>
  layers: readonly ReadLayer<Doc>[]
}

/** Assemble decoration here; readers never reconstruct a query subclass. */
export function decorateReadQuery<Doc>(source: any, layer: ReadLayer<Doc>): ReadQuery<Doc> {
  const plan: ReadPlan<Doc> | undefined = source[planKey]
  return new ReadQuery(
    plan
      ? { source: plan.source, layers: [...plan.layers, layer] }
      : {
          source,
          layers: [layer]
        }
  )
}

/**
 * Owns terminal cardinality and layer boundaries. A batch terminal completes its
 * inner layer before applying the outer layer; iteration remains per-document.
 * Rules first/take/collect deliberately switch to iteration at that layer.
 */
class ReadQuery<Doc> {
  readonly [planKey]: ReadPlan<Doc>

  constructor(plan: ReadPlan<Doc>) {
    this[planKey] = plan
  }

  private get plan(): ReadPlan<Doc> {
    return this[planKey]
  }

  private withSource(source: QuerySource<Doc>): ReadQuery<Doc> {
    return new ReadQuery({ source, layers: this.plan.layers })
  }

  fullTableScan() {
    return this.withSource(this.plan.source.fullTableScan())
  }
  withIndex(...args: any[]) {
    return this.withSource(this.plan.source.withIndex(...args))
  }
  withSearchIndex(...args: any[]) {
    return this.withSource(this.plan.source.withSearchIndex(...args))
  }
  order(...args: any[]) {
    return this.withSource(this.plan.source.order(...args))
  }
  filter(...args: any[]) {
    return this.withSource(this.plan.source.filter(...args))
  }
  limit(n: number) {
    return this.withSource(this.plan.source.limit(n))
  }

  async count(): Promise<number> {
    // Check outside-in, just as delegation through nested rules previously did.
    for (let index = this.plan.layers.length - 1; index >= 0; index--) {
      const layer = this.plan.layers[index]
      if (layer.kind === 'rules' && !layer.allowCounting) {
        throw new Error('count is not allowed with rules')
      }
    }
    return this.plan.source.count()
  }

  first(): Promise<Doc | null> {
    return this.single('first', this.plan.layers.length)
  }
  unique(): Promise<Doc | null> {
    return this.single('unique', this.plan.layers.length)
  }
  collect(): Promise<Doc[]> {
    return this.many('collect', this.plan.layers.length, 0)
  }
  take(n: number): Promise<Doc[]> {
    return this.many('take', this.plan.layers.length, n)
  }
  paginate(opts: PaginationOptions): Promise<PaginationResult<Doc>> {
    return this.page(opts, this.plan.layers.length)
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<Doc> {
    return this.iterate(this.plan.layers.length)
  }

  private async single(terminal: 'first' | 'unique', depth: number): Promise<Doc | null> {
    if (depth === 0) return this.plan.source[terminal]()
    const layer = this.plan.layers[depth - 1]
    if (terminal === 'first' && layer.kind === 'rules') {
      for await (const doc of this.iterate(depth)) return doc
      return null
    }
    const doc = await this.single(terminal, depth - 1)
    return doc === null ? null : processRead(layer, doc)
  }

  private async many(terminal: 'collect' | 'take', depth: number, n: number): Promise<Doc[]> {
    if (depth === 0) {
      return terminal === 'collect' ? this.plan.source.collect() : this.plan.source.take(n)
    }
    const layer = this.plan.layers[depth - 1]
    if (layer.kind === 'rules') {
      if (terminal === 'take' && (!Number.isInteger(n) || n < 0)) {
        throw new Error('take requires a non-negative integer')
      }
      const docs: Doc[] = []
      if (terminal === 'take' && n === 0) return docs
      for await (const doc of this.iterate(depth)) {
        docs.push(doc)
        if (terminal === 'take' && docs.length >= n) break
      }
      return docs
    }
    return this.batch(layer, await this.many(terminal, depth - 1, n))
  }

  private async page(opts: PaginationOptions, depth: number): Promise<PaginationResult<Doc>> {
    if (depth === 0) return this.plan.source.paginate(opts)
    const result = { ...(await this.page(opts, depth - 1)) }
    const layer = this.plan.layers[depth - 1]
    const page = await this.batch(layer, result.page)
    return { ...result, page }
  }

  private async batch(layer: ReadLayer<Doc>, docs: Doc[]): Promise<Doc[]> {
    // Full synchronous parsing must finish before the next layer's callbacks.
    if (layer.kind === 'decode') return docs.map(doc => decodeDoc(layer.schema, doc) as Doc)
    // The former passthrough parse made a shallow array snapshot at each layer.
    // Callback mutations of an externally retained native array must not add reads.
    const incoming = docs.slice()
    if (layer.kind === 'audit') {
      for (const doc of incoming) await processRead(layer, doc)
      return incoming
    }
    const results: Doc[] = []
    for (const doc of incoming) {
      const result = await processRead(layer, doc)
      if (result !== null) results.push(result)
    }
    return results
  }

  private async *iterate(depth: number): AsyncIterableIterator<Doc> {
    if (depth === 0) {
      yield* this.plan.source
      return
    }
    const layer = this.plan.layers[depth - 1]
    for await (const doc of this.iterate(depth - 1)) {
      const result = await processRead(layer, doc)
      if (layer.kind !== 'rules' || result !== null) yield result as Doc
    }
  }
}
