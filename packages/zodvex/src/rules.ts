import type {
  GenericDataModel,
  GenericTableInfo,
  PaginationOptions,
  PaginationResult,
  TableNamesInDataModel
} from 'convex/server'
import type { GenericId } from 'convex/values'
import { CodecDatabaseReader, CodecQueryChain } from './db'

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
export type CodecRules<
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
export type CodecRulesConfig = {
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
 * Extends CodecQueryChain, applying a read rule at every terminal method.
 * Intermediate methods are inherited from the base class via createChain().
 * Only terminals and createChain() are overridden.
 */
export class RulesCodecQueryChain<TableInfo extends GenericTableInfo, Doc> extends CodecQueryChain<
  TableInfo,
  Doc
> {
  private readRule: ReadRule<any, Doc>
  private rulesConfig: CodecRulesConfig
  private ctx: any

  constructor(
    inner: any,
    schema: any,
    readRule: ReadRule<any, Doc>,
    config: CodecRulesConfig,
    ctx: any = {}
  ) {
    super(inner, schema)
    this.readRule = readRule
    this.rulesConfig = config
    this.ctx = ctx
  }

  protected createChain(inner: any): RulesCodecQueryChain<TableInfo, Doc> {
    return new RulesCodecQueryChain(inner, this.schema, this.readRule, this.rulesConfig, this.ctx)
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
 * Wraps a CodecDatabaseReader with per-table read rules.
 * Extends CodecDatabaseReader so it can be used anywhere a reader is expected,
 * including chained `.withRules()` calls.
 *
 * - `get()` delegates to the inner reader (which decodes), then applies the read rule.
 * - `query()` builds a RulesCodecQueryChain from the raw Convex query + doc schema,
 *   so decoding and rule-checking happen together in the chain's terminal methods.
 */
class RulesCodecDatabaseReader<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>
> extends CodecDatabaseReader<DataModel, DecodedDocs> {
  constructor(
    private inner: CodecDatabaseReader<DataModel, DecodedDocs>,
    private ctx: any,
    private rules: Record<string, TableRules<any, any>>,
    private rulesConfig: CodecRulesConfig
  ) {
    // Pass the inner's protected db + tableMap to super.
    super((inner as any).db, (inner as any).tableMap)
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
    const passthroughSchema = { parse: (x: any) => x }
    return new RulesCodecQueryChain(
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
    // If not found in rules, check ALL tables from tableMap for defaultPolicy: deny
    if ((this.rulesConfig.defaultPolicy ?? 'allow') === 'deny') {
      for (const tableName of Object.keys(this.tableMap)) {
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
 * Factory function for creating a RulesCodecDatabaseReader.
 * Breaks the circular dependency between db.ts (which imports this) and rules.ts
 * (which imports CodecDatabaseReader from db.ts).
 */
export function createRulesCodecDatabaseReader<
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>
>(
  inner: CodecDatabaseReader<DataModel, DecodedDocs>,
  ctx: any,
  rules: Record<string, TableRules<any, any>>,
  config?: CodecRulesConfig
): CodecDatabaseReader<DataModel, DecodedDocs> {
  return new RulesCodecDatabaseReader(inner, ctx, rules, config ?? {})
}
