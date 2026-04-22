/**
 * Shared types used by both db.ts and rules.ts.
 * Extracted to break the circular dependency between them.
 */

import type { GenericDataModel, TableNamesInDataModel } from 'convex/server'
import type { GenericId } from 'convex/values'

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
 * Describes a pending write operation for `beforeWrite` hooks.
 * Mirrors WriteEvent but for pre-write dispatch:
 * - insert has no `id` yet (Convex assigns it on write)
 * - patch/replace/delete include the current `doc` read from the database
 *
 * The hook MAY return a replacement `value` for insert/patch/replace to
 * transform the write. Returning `void`/`undefined` leaves the value
 * unchanged. For delete there is no value to transform.
 */
export type WriteIntent<Doc = any> =
  | { type: 'insert'; value: InsertDoc<Doc> }
  | { type: 'patch'; id: GenericId<any>; doc: Doc; value: Partial<Doc> }
  | { type: 'replace'; id: GenericId<any>; doc: Doc; value: Doc }
  | { type: 'delete'; id: GenericId<any>; doc: Doc }

/**
 * Return type for `beforeWrite`. When the hook fires for a given event type,
 * it may return a replacement value of the matching shape, or `void`/`undefined`
 * to signal "no change".
 *
 * - insert: full next insert value (InsertDoc<Doc>)
 * - patch:  full next patch value (Partial<Doc>) — replaces the incoming patch
 * - replace: full next replacement (Doc)
 * - delete: no transformation supported
 */
export type BeforeWriteResult<Doc, Intent extends WriteIntent<Doc>> = Intent extends {
  type: 'insert'
}
  ? InsertDoc<Doc> | void
  : Intent extends { type: 'patch' }
    ? Partial<Doc> | void
    : Intent extends { type: 'replace' }
      ? Doc | void
      : void

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
  /**
   * Fires before insert/patch/replace/delete. May return a replacement value
   * (matching the event's shape) to transform the write, or void to leave it
   * unchanged. See WriteIntent + BeforeWriteResult for per-event return types.
   *
   * Ordering: fires AFTER any upstream `.withRules()` write-rule transforms
   * (rules run in the order they were chained). Sees decoded values —
   * encoding happens inside the inner writer after the hook returns.
   */
  beforeWrite?: <T extends TableNamesInDataModel<DataModel>>(
    table: T,
    intent: WriteIntent<ResolveDecodedDocForRules<DataModel, DecodedDocs, T>>
  ) =>
    | BeforeWriteResult<
        ResolveDecodedDocForRules<DataModel, DecodedDocs, T>,
        WriteIntent<ResolveDecodedDocForRules<DataModel, DecodedDocs, T>>
      >
    | Promise<
        BeforeWriteResult<
          ResolveDecodedDocForRules<DataModel, DecodedDocs, T>,
          WriteIntent<ResolveDecodedDocForRules<DataModel, DecodedDocs, T>>
        >
      >
}
