import type {
  GenericDataModel,
  GenericTableInfo,
  PaginationOptions,
  PaginationResult,
  TableNamesInDataModel
} from 'convex/server'
import type { GenericId } from 'convex/values'
import { z } from 'zod'
import { ZodvexDatabaseReader, ZodvexDatabaseWriter, ZodvexQueryChain } from './db'

export {
  type BeforeWriteResult,
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
  type WriteIntent,
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
  WriteIntent,
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
    return new RulesQueryChain(inner, this.schema, this.readRule, this.rulesConfig, this.ctx)
  }

  // --- Terminal overrides: apply read rule ---

  async first(): Promise<Doc | null> {
    for await (const doc of this) {
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
    for await (const doc of this) {
      results.push(doc)
    }
    return results
  }

  async take(n: number): Promise<Doc[]> {
    const results: Doc[] = []
    for await (const doc of this) {
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
 * Extends ZodvexDatabaseReader so it can be used anywhere a reader is expected,
 * including chained `.withRules()` calls.
 *
 * - `get()` delegates to the inner reader (which decodes), then applies the read rule.
 * - `query()` builds a RulesQueryChain from the raw Convex query + doc schema,
 *   so decoding and rule-checking happen together in the chain's terminal methods.
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
    // Pass the inner's protected db + tableMap to super.
    const { db, tableMap } = inner._internals
    super(db, tableMap)
    this.system = inner.system
  }

  async get(idOrTable: any, maybeId?: any): Promise<any> {
    const doc = await this.inner.get(idOrTable, maybeId)
    if (doc === null) return null

    // Resolve table name for rule lookup
    const tableName =
      maybeId !== undefined ? (idOrTable as string) : this.resolveTableFromId(idOrTable)

    if (!tableName) return doc
    return this.applyReadRule(tableName, doc)
  }

  query<TableName extends TableNamesInDataModel<DataModel>>(tableName: TableName): any {
    const tableRules = this.rules[tableName as string]

    if (!tableRules?.read && (this.rulesConfig.defaultPolicy ?? 'allow') === 'allow') {
      // No rule + allow policy -> delegate to inner (preserves any upstream rules)
      return this.inner.query(tableName)
    }

    // Delegate to inner.query() which returns a decoded (and possibly rule-filtered) chain.
    // Wrap with a passthrough schema since inner already decoded the docs.
    const innerChain = this.inner.query(tableName)
    const readRule = tableRules?.read ?? (async () => null) // deny if no rule + deny policy
    const passthroughSchema = z.any()
    return new RulesQueryChain(innerChain, passthroughSchema, readRule, this.rulesConfig, this.ctx)
  }

  // normalizeId requires TableNamesInDataModel but we iterate dynamic string keys — cast required
  private resolveTableFromId(id: any): string | null {
    for (const tableName of Object.keys(this.rules)) {
      if (this.inner.normalizeId(tableName as any, id as unknown as string)) {
        return tableName
      }
    }
    // If not found in rules, check ALL tables from tableMap for defaultPolicy: deny
    if ((this.rulesConfig.defaultPolicy ?? 'allow') === 'deny') {
      for (const tableName of Object.keys(this.inner._internals.tableMap)) {
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
 * Factory function for creating a RulesDatabaseReader.
 * Breaks the circular dependency between db.ts (which imports this) and rules.ts
 * (which imports ZodvexDatabaseReader from db.ts).
 */
export function createRulesDatabaseReader<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>
>(
  inner: ZodvexDatabaseReader<DataModel, DecodedDocs>,
  ctx: any,
  rules: Record<string, TableRules<any, any>>,
  config?: ZodvexRulesConfig
): ZodvexDatabaseReader<DataModel, DecodedDocs> {
  return new RulesDatabaseReader(inner, ctx, rules, config ?? {})
}

/**
 * Wraps a ZodvexDatabaseWriter with per-table read and write rules.
 * Extends ZodvexDatabaseWriter so it can be used anywhere a writer is expected.
 *
 * - Read operations (get, query) delegate through an internal RulesDatabaseReader.
 * - Write operations (insert, patch, replace, delete) apply per-operation rules
 *   that can transform values or throw to deny.
 * - Write operations delegate to `this.inner` (the original ZodvexDatabaseWriter),
 *   NOT to `super`. Rules transform decoded values; the inner writer handles encoding.
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
    // Pass the inner's protected db + tableMap to super.
    const { db, tableMap, reader: innerReader } = inner._internals
    super(db, tableMap)
    // Build a rules-aware reader from the inner writer's reader for read operations.
    this.rulesReader = new RulesDatabaseReader(innerReader, ctx, rules, rulesConfig)
    this.system = inner.system
  }

  // --- Read methods: delegate through rules-aware reader ---

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

  // --- Write methods: apply rules, then delegate to inner writer ---

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
    // Resolve arguments: support both patch(id, value) and patch(table, id, value)
    let id: any
    let value: any

    if (maybeValue !== undefined) {
      id = idOrValue
      value = maybeValue
    } else {
      id = idOrTable
      value = idOrValue
    }

    // Fetch current doc via rules-aware reader (applies read rules)
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

    // Fetch current doc via rules-aware reader (applies read rules)
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

    // Fetch current doc via rules-aware reader (applies read rules)
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

  // normalizeId requires TableNamesInDataModel but we iterate dynamic string keys — cast required
  private resolveTableFromId(id: any): string | null {
    for (const tableName of Object.keys(this.rules)) {
      if (this.inner.normalizeId(tableName as any, id as unknown as string)) {
        return tableName
      }
    }
    // If not found in rules, check ALL tables from tableMap for defaultPolicy: deny
    if ((this.rulesConfig.defaultPolicy ?? 'allow') === 'deny') {
      for (const tableName of Object.keys(this.inner._internals.tableMap)) {
        if (this.inner.normalizeId(tableName as any, id as unknown as string)) {
          return tableName
        }
      }
    }
    return null
  }
}

/**
 * Factory function for creating a RulesDatabaseWriter.
 * Breaks the circular dependency between db.ts and rules.ts.
 */
export function createRulesDatabaseWriter<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>
>(
  inner: ZodvexDatabaseWriter<DataModel, DecodedDocs>,
  ctx: any,
  rules: Record<string, TableRules<any, any>>,
  config?: ZodvexRulesConfig
): ZodvexDatabaseWriter<DataModel, DecodedDocs> {
  return new RulesDatabaseWriter(inner, ctx, rules, config ?? {})
}

// ============================================================================
// Audit wrapping — afterRead and afterWrite callbacks
// ============================================================================

/**
 * Extends ZodvexQueryChain to fire an afterRead callback for each document
 * returned by terminal methods. Intermediate methods are inherited via
 * createChain(). Only terminals and createChain() are overridden.
 *
 * The tableName is captured at construction so the afterRead callback
 * knows which table each document came from.
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
    return new AuditQueryChain(inner, this.schema, this.afterRead, this.tableName)
  }

  // --- Terminal overrides: fire afterRead for each returned doc ---

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

  // count() passes through — no docs to audit

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
 * Extends ZodvexDatabaseReader so it can be used anywhere a reader is expected,
 * including chained `.audit()` and `.withRules()` calls.
 *
 * - `get()` delegates to the inner reader, fires afterRead if doc is non-null.
 * - `query()` wraps the inner chain in an AuditQueryChain with a passthrough
 *   schema (inner already decoded).
 */
class AuditDatabaseReader<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>
> extends ZodvexDatabaseReader<DataModel, DecodedDocs> {
  private inner: ZodvexDatabaseReader<DataModel, DecodedDocs>
  private afterRead: (table: string, doc: any) => void | Promise<void>

  constructor(inner: ZodvexDatabaseReader<DataModel, DecodedDocs>, config: ReaderAuditConfig) {
    // Pass the inner's protected db + tableMap to super.
    const { db, tableMap } = inner._internals
    super(db, tableMap)
    this.inner = inner
    this.afterRead =
      config.afterRead ??
      (() => {
        /* noop */
      })
    this.system = inner.system
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
    // Passthrough schema since inner already decoded
    const passthroughSchema = z.any()
    return new AuditQueryChain(innerChain, passthroughSchema, this.afterRead, tableName as string)
  }

  /**
   * Resolves table name from an ID by trying normalizeId against known tables.
   * If explicitTable is provided (for the 2-arg get form), use it directly.
   * normalizeId requires TableNamesInDataModel but we iterate dynamic string keys — cast required.
   */
  private resolveTableFromId(id: any, explicitTable?: string): string | null {
    if (explicitTable) return explicitTable
    for (const tableName of Object.keys(this.tableMap)) {
      if (this.inner.normalizeId(tableName as any, id as unknown as string)) {
        return tableName
      }
    }
    return null
  }
}

/**
 * Factory function for creating an AuditDatabaseReader.
 * Called via deferred require() from ZodvexDatabaseReader.audit() in db.ts.
 */
export function createAuditDatabaseReader<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>
>(
  inner: ZodvexDatabaseReader<DataModel, DecodedDocs>,
  config: ReaderAuditConfig
): ZodvexDatabaseReader<DataModel, DecodedDocs> {
  return new AuditDatabaseReader(inner, config)
}

/**
 * Wraps a ZodvexDatabaseWriter with afterRead and afterWrite audit callbacks.
 * Extends ZodvexDatabaseWriter so it can be used anywhere a writer is expected.
 *
 * - Read operations delegate through an internal AuditDatabaseReader for afterRead.
 * - Write operations delegate to `this.inner` (not super) so encoding happens via
 *   the original writer. Audit observes decoded values (pre-encoding).
 * - For patch/replace/delete, the current doc is fetched via `this.inner.get()` (not the
 *   audited reader) to avoid audit-of-audit recursion for reads triggered by writes.
 */
class AuditDatabaseWriter<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>
> extends ZodvexDatabaseWriter<DataModel, DecodedDocs> {
  private inner: ZodvexDatabaseWriter<DataModel, DecodedDocs>
  private auditReader: ZodvexDatabaseReader<DataModel, DecodedDocs>
  private afterWrite: ((table: string, event: WriteEvent) => void | Promise<void>) | undefined
  private beforeWrite: ((table: string, intent: WriteIntent) => any | Promise<any>) | undefined

  constructor(inner: ZodvexDatabaseWriter<DataModel, DecodedDocs>, config: WriterAuditConfig) {
    // Pass the inner's protected db + tableMap to super.
    const { db, tableMap, reader: innerReader } = inner._internals
    super(db, tableMap)
    this.inner = inner
    // Generic WriterAuditConfig.afterWrite / beforeWrite signatures widen to string-keyed dispatch internally
    this.afterWrite = config.afterWrite as typeof this.afterWrite
    this.beforeWrite = config.beforeWrite as typeof this.beforeWrite

    // Build an audit-aware reader from the inner writer's reader for read operations.
    this.auditReader = config.afterRead
      ? new AuditDatabaseReader(innerReader, { afterRead: config.afterRead })
      : innerReader
    this.system = inner.system
  }

  // --- Read methods: delegate through audit-aware reader ---

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

  // --- Write methods: fire beforeWrite, delegate to inner, then fire afterWrite ---

  async insert(table: any, value: any): Promise<any> {
    let nextValue = value
    if (this.beforeWrite) {
      const result = await this.beforeWrite(table as string, { type: 'insert', value })
      if (result !== undefined) nextValue = result
    }
    const id = await this.inner.insert(table, nextValue)
    if (this.afterWrite) {
      await this.afterWrite(table as string, { type: 'insert', id, value: nextValue })
    }
    return id
  }

  async patch(idOrTable: any, idOrValue: any, maybeValue?: any): Promise<void> {
    // Resolve arguments
    let id: any
    let value: any

    if (maybeValue !== undefined) {
      id = idOrValue
      value = maybeValue
    } else {
      id = idOrTable
      value = idOrValue
    }

    // Fetch current doc via inner (not audited) to avoid audit recursion
    const doc = await this.inner.get(id)

    let nextValue = value
    if (this.beforeWrite && doc !== null) {
      const tableName = this.resolveTableFromId(id)
      if (tableName) {
        const result = await this.beforeWrite(tableName, { type: 'patch', id, doc, value })
        if (result !== undefined) nextValue = result
      }
    }

    // Delegate the actual write to inner
    if (maybeValue !== undefined) {
      await this.inner.patch(idOrTable, idOrValue, nextValue)
    } else {
      await this.inner.patch(id, nextValue)
    }

    if (this.afterWrite) {
      const tableName = this.resolveTableFromId(id)
      if (tableName) {
        await this.afterWrite(tableName, { type: 'patch', id, doc, value: nextValue })
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

    // Fetch current doc via inner to avoid audit recursion
    const doc = await this.inner.get(id)

    let nextValue = value
    if (this.beforeWrite && doc !== null) {
      const tableName = this.resolveTableFromId(id)
      if (tableName) {
        const result = await this.beforeWrite(tableName, { type: 'replace', id, doc, value })
        if (result !== undefined) nextValue = result
      }
    }

    // Delegate the actual write to inner
    if (maybeValue !== undefined) {
      await this.inner.replace(idOrTable, idOrValue, nextValue)
    } else {
      await this.inner.replace(id, nextValue)
    }

    if (this.afterWrite) {
      const tableName = this.resolveTableFromId(id)
      if (tableName) {
        await this.afterWrite(tableName, { type: 'replace', id, doc, value: nextValue })
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

    // Fetch current doc via inner to avoid audit recursion
    const doc = await this.inner.get(id)

    if (this.beforeWrite && doc !== null) {
      const tableName = this.resolveTableFromId(id)
      if (tableName) {
        // Delete intent is observational — return value is ignored.
        await this.beforeWrite(tableName, { type: 'delete', id, doc })
      }
    }

    // Delegate the actual delete to inner
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

  // normalizeId requires TableNamesInDataModel but we iterate dynamic string keys — cast required
  private resolveTableFromId(id: any): string | null {
    for (const tableName of Object.keys(this.inner._internals.tableMap)) {
      if (this.inner.normalizeId(tableName as any, id as unknown as string)) {
        return tableName
      }
    }
    return null
  }
}

/**
 * Factory function for creating an AuditDatabaseWriter.
 * Called from ZodvexDatabaseWriter.audit() in db.ts.
 */
export function createAuditDatabaseWriter<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>
>(
  inner: ZodvexDatabaseWriter<DataModel, DecodedDocs>,
  config: WriterAuditConfig
): ZodvexDatabaseWriter<DataModel, DecodedDocs> {
  return new AuditDatabaseWriter(inner, config)
}
