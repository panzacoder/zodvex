import type {
  GenericDataModel,
  GenericTableInfo,
  PaginationOptions,
  PaginationResult,
  TableNamesInDataModel
} from 'convex/server'
import type { GenericId } from 'convex/values'
import { z } from 'zod'
// Type-only imports of db.ts classes — no runtime cycle. The actual class
// references arrive at runtime via installRulesSubclasses() below, which
// db.ts calls once its base classes are fully declared.
import type { ZodvexDatabaseReader, ZodvexDatabaseWriter, ZodvexQueryChain } from './db'

export {
  type DeleteRule,
  type InsertDoc,
  type InsertRule,
  type PatchRule,
  type ReaderAuditConfig,
  type ReadRule,
  type ReplaceRule,
  type ResolveDecodedDocForRules,
  type TableRules,
  type WriteEvent,
  type WriterAuditConfig,
  type ZodvexRules,
  type ZodvexRulesConfig
} from './ruleTypes'

import type {
  InsertDoc,
  ReaderAuditConfig,
  ReadRule,
  ResolveDecodedDocForRules,
  TableRules,
  WriteEvent,
  WriterAuditConfig,
  ZodvexRules,
  ZodvexRulesConfig
} from './ruleTypes'

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

// ============================================================================
// Subclass storage + installer
// ============================================================================
//
// The six classes below (Rules* and Audit*) all extend classes declared in
// db.ts. Declaring them at module top level would force rules.ts to dereference
// those base classes at its own module-init time — which in turn would force
// db.ts to run first. But db.ts imports rules.ts, so it cannot. That's the
// circular dependency.
//
// The fix: keep rules.ts top-level free of runtime references to db.ts. All
// subclass declarations live inside `installRulesSubclasses`, which db.ts
// calls AFTER its own class declarations are complete. At that point, the
// base classes are real values and the extends chain resolves correctly.
//
// This replaces an earlier `dynamic import()` workaround, which had a timing
// race: callers that invoked `.withRules()` or `.audit()` synchronously
// (e.g., inside a `withContext` input function at mutation wire-up time)
// could hit the guard before the dynamic import resolved.

type Subclasses = {
  RulesQueryChain: any
  RulesDatabaseReader: any
  RulesDatabaseWriter: any
  AuditQueryChain: any
  AuditDatabaseReader: any
  AuditDatabaseWriter: any
}

let _subclasses: Subclasses | null = null

/**
 * ESM live-binding for test-facing direct construction of `RulesQueryChain`.
 * Populated by `installRulesSubclasses`. Importers automatically see the
 * real class after install runs (which happens at db.ts module init).
 */
export let RulesQueryChain: any = null

function getSubclasses(): Subclasses {
  if (!_subclasses) {
    throw new Error(
      'zodvex rules subclasses not installed. This usually means the rules module ' +
        'was loaded without db.ts running its installer. Import zodvex via the ' +
        'public entry (zodvex/server) so db.ts initializes first.'
    )
  }
  return _subclasses
}

/**
 * Called once by db.ts after its base classes are declared. Builds the
 * Rules*/
/* and Audit* subclasses with the correct extends chain. Safe to call
 * multiple times (idempotent).
 */
export function installRulesSubclasses(bases: {
  ZodvexQueryChain: typeof ZodvexQueryChain
  ZodvexDatabaseReader: typeof ZodvexDatabaseReader
  ZodvexDatabaseWriter: typeof ZodvexDatabaseWriter
}): void {
  if (_subclasses) return

  const Base = bases as {
    ZodvexQueryChain: any
    ZodvexDatabaseReader: any
    ZodvexDatabaseWriter: any
  }

  /**
   * Extends ZodvexQueryChain, applying a read rule at every terminal method.
   * Intermediate methods are inherited from the base class via createChain().
   * Only terminals and createChain() are overridden.
   */
  class _RulesQueryChain<TableInfo extends GenericTableInfo, Doc> extends Base.ZodvexQueryChain {
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

    protected createChain(inner: any): _RulesQueryChain<TableInfo, Doc> {
      return new _RulesQueryChain(
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
      const results: Doc[] = []
      for await (const doc of this as any) {
        if (results.length >= n) break
        results.push(doc)
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
      const iter = super[Symbol.asyncIterator]()
      while (true) {
        const { value, done } = await iter.next()
        if (done) break
        const result = normalizeReadResult(await this.readRule(this.ctx, value), value)
        if (result !== null) yield result
      }
    }
  }

  /**
   * Wraps a ZodvexDatabaseReader with per-table read rules.
   */
  class _RulesDatabaseReader<
    DataModel extends GenericDataModel,
    DecodedDocs extends Record<string, any>
  > extends Base.ZodvexDatabaseReader {
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
      return new _RulesQueryChain(
        innerChain,
        passthroughSchema,
        readRule,
        this.rulesConfig,
        this.ctx
      )
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
  class _RulesDatabaseWriter<
    DataModel extends GenericDataModel,
    DecodedDocs extends Record<string, any>
  > extends Base.ZodvexDatabaseWriter {
    private rulesReader: ZodvexDatabaseReader<DataModel, DecodedDocs>

    constructor(
      private inner: ZodvexDatabaseWriter<DataModel, DecodedDocs>,
      private ctx: any,
      private rules: Record<string, TableRules<any, any>>,
      private rulesConfig: ZodvexRulesConfig
    ) {
      const { db, tableMap, reader: innerReader } = (inner as any)._internals
      super(db, tableMap)
      this.rulesReader = new _RulesDatabaseReader(innerReader, ctx, rules, rulesConfig) as any
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
        return this.inner.insert(table, transformed)
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
        return this.inner.patch(id, transformed)
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
  class _AuditQueryChain<TableInfo extends GenericTableInfo, Doc> extends Base.ZodvexQueryChain {
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

    protected createChain(inner: any): _AuditQueryChain<TableInfo, Doc> {
      return new _AuditQueryChain(inner, (this as any).schema, this.afterRead, this.tableName)
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
      const iter = super[Symbol.asyncIterator]()
      while (true) {
        const { value, done } = await iter.next()
        if (done) break
        await this.afterRead(this.tableName, value)
        yield value
      }
    }
  }

  /**
   * Wraps a ZodvexDatabaseReader with afterRead audit callbacks.
   */
  class _AuditDatabaseReader<
    DataModel extends GenericDataModel,
    DecodedDocs extends Record<string, any>
  > extends Base.ZodvexDatabaseReader {
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
      return new _AuditQueryChain(
        innerChain,
        passthroughSchema,
        this.afterRead,
        tableName as string
      )
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
  class _AuditDatabaseWriter<
    DataModel extends GenericDataModel,
    DecodedDocs extends Record<string, any>
  > extends Base.ZodvexDatabaseWriter {
    private inner: ZodvexDatabaseWriter<DataModel, DecodedDocs>
    private auditReader: ZodvexDatabaseReader<DataModel, DecodedDocs>
    private afterWrite: ((table: string, event: WriteEvent) => void | Promise<void>) | undefined

    constructor(inner: ZodvexDatabaseWriter<DataModel, DecodedDocs>, config: WriterAuditConfig) {
      const { db, tableMap, reader: innerReader } = (inner as any)._internals
      super(db, tableMap)
      this.inner = inner
      this.afterWrite = config.afterWrite as typeof this.afterWrite

      this.auditReader = config.afterRead
        ? (new _AuditDatabaseReader(innerReader, { afterRead: config.afterRead }) as any)
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

  // Populate module slots. ESM live-binding updates importers of
  // `RulesQueryChain` automatically.
  RulesQueryChain = _RulesQueryChain
  _subclasses = {
    RulesQueryChain: _RulesQueryChain,
    RulesDatabaseReader: _RulesDatabaseReader,
    RulesDatabaseWriter: _RulesDatabaseWriter,
    AuditQueryChain: _AuditQueryChain,
    AuditDatabaseReader: _AuditDatabaseReader,
    AuditDatabaseWriter: _AuditDatabaseWriter
  }
}

// ============================================================================
// Factory functions — public surface called by db.ts methods
// ============================================================================

export function createRulesDatabaseReader<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>
>(
  inner: ZodvexDatabaseReader<DataModel, DecodedDocs>,
  ctx: any,
  rules: Record<string, TableRules<any, any>>,
  config?: ZodvexRulesConfig
): ZodvexDatabaseReader<DataModel, DecodedDocs> {
  return new (getSubclasses().RulesDatabaseReader)(inner, ctx, rules, config ?? {})
}

export function createRulesDatabaseWriter<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>
>(
  inner: ZodvexDatabaseWriter<DataModel, DecodedDocs>,
  ctx: any,
  rules: Record<string, TableRules<any, any>>,
  config?: ZodvexRulesConfig
): ZodvexDatabaseWriter<DataModel, DecodedDocs> {
  return new (getSubclasses().RulesDatabaseWriter)(inner, ctx, rules, config ?? {})
}

export function createAuditDatabaseReader<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>
>(
  inner: ZodvexDatabaseReader<DataModel, DecodedDocs>,
  config: ReaderAuditConfig
): ZodvexDatabaseReader<DataModel, DecodedDocs> {
  return new (getSubclasses().AuditDatabaseReader)(inner, config)
}

export function createAuditDatabaseWriter<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>
>(
  inner: ZodvexDatabaseWriter<DataModel, DecodedDocs>,
  config: WriterAuditConfig
): ZodvexDatabaseWriter<DataModel, DecodedDocs> {
  return new (getSubclasses().AuditDatabaseWriter)(inner, config)
}
