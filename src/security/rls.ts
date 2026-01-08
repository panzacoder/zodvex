/**
 * Row-Level Security (RLS) primitives.
 *
 * This module provides functions for checking and enforcing row-level access:
 * - checkRlsRead() - Check if a read is allowed
 * - checkRlsWrite() - Check if a write operation is allowed
 * - filterByRls() - Filter an array of documents by read rules
 */

import type { RlsCheckResult, RlsRule } from './types'

/**
 * Check if a read operation is allowed by RLS rules.
 *
 * @param ctx - The security context
 * @param doc - The document being read
 * @param rule - The RLS rule for this table (undefined = allow all)
 * @returns Result indicating if read is allowed
 *
 * @example
 * ```ts
 * const rule: RlsRule<Ctx, Doc> = {
 *   read: (ctx, doc) => ctx.userId === doc.ownerId
 * }
 * const result = await checkRlsRead(ctx, doc, rule)
 * if (!result.allowed) {
 *   // Handle denied access
 * }
 * ```
 */
export async function checkRlsRead<TCtx, TDoc>(
  ctx: TCtx,
  doc: TDoc,
  rule: RlsRule<TCtx, TDoc> | undefined
): Promise<RlsCheckResult> {
  if (!rule?.read) {
    return { allowed: true }
  }

  const allowed = await rule.read(ctx, doc)
  return {
    allowed,
    reason: allowed ? undefined : 'rls_read_denied'
  }
}

/**
 * Check if a write operation is allowed by RLS rules.
 *
 * @param ctx - The security context
 * @param doc - The document being written (new doc for insert/update, existing for delete)
 * @param rule - The RLS rule for this table (undefined = allow all)
 * @param operation - The write operation type
 * @param oldDoc - For updates, the existing document before changes
 * @returns Result indicating if write is allowed
 *
 * @example
 * ```ts
 * const rule: RlsRule<Ctx, Doc> = {
 *   insert: (ctx, doc) => ctx.userId === doc.ownerId,
 *   update: (ctx, old, new_) => ctx.userId === old.ownerId,
 *   delete: (ctx, doc) => ctx.role === 'admin'
 * }
 *
 * // Check insert
 * const insertResult = await checkRlsWrite(ctx, newDoc, rule, 'insert')
 *
 * // Check update (requires old doc)
 * const updateResult = await checkRlsWrite(ctx, newDoc, rule, 'update', oldDoc)
 * ```
 */
export async function checkRlsWrite<TCtx, TDoc>(
  ctx: TCtx,
  doc: TDoc,
  rule: RlsRule<TCtx, TDoc> | undefined,
  operation: 'insert' | 'update' | 'delete',
  oldDoc?: TDoc
): Promise<RlsCheckResult> {
  const opRule = rule?.[operation]
  if (!opRule) {
    return { allowed: true }
  }

  let allowed: boolean
  if (operation === 'update' && oldDoc !== undefined) {
    // Update rule receives both old and new documents
    allowed = await (opRule as (ctx: TCtx, old: TDoc, new_: TDoc) => boolean | Promise<boolean>)(
      ctx,
      oldDoc,
      doc
    )
  } else {
    // Insert and delete rules receive only the document
    allowed = await (opRule as (ctx: TCtx, doc: TDoc) => boolean | Promise<boolean>)(ctx, doc)
  }

  return {
    allowed,
    reason: allowed ? undefined : `rls_${operation}_denied`
  }
}

/**
 * Filter an array of documents by RLS read rules.
 *
 * Checks each document against the read rule and returns only those
 * that pass. Preserves document order.
 *
 * @param ctx - The security context
 * @param docs - Array of documents to filter
 * @param rule - The RLS rule for this table (undefined = return all)
 * @returns Filtered array of documents the user can read
 *
 * @example
 * ```ts
 * const rule: RlsRule<Ctx, Doc> = {
 *   read: (ctx, doc) => ctx.userId === doc.ownerId || doc.isPublic
 * }
 * const allDocs = await db.query('posts').collect()
 * const visibleDocs = await filterByRls(ctx, allDocs, rule)
 * ```
 */
export async function filterByRls<TCtx, TDoc>(
  ctx: TCtx,
  docs: TDoc[],
  rule: RlsRule<TCtx, TDoc> | undefined
): Promise<TDoc[]> {
  if (!rule?.read) {
    return docs
  }

  const results = await Promise.all(
    docs.map(async doc => ({
      doc,
      allowed: await rule.read!(ctx, doc)
    }))
  )

  return results.filter(r => r.allowed).map(r => r.doc)
}
