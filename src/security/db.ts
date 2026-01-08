/**
 * Secure database wrappers combining RLS and FLS.
 *
 * This module provides wrapped database readers and writers that:
 * - Apply Row-Level Security (RLS) checks on all operations
 * - Apply Field-Level Security (FLS) transforms on read results
 *
 * @example
 * ```ts
 * const reader = createSecureReader(ctx.db, securityCtx, {
 *   rules: { users: { read: (ctx, doc) => ctx.userId === doc._id } },
 *   resolver: entitlementResolver,
 *   schemas: { users: userSchema }
 * })
 *
 * // Automatically applies RLS filter + FLS transforms
 * const user = await reader.get('users', userId)
 * ```
 */

import type { z } from 'zod'
import type { EntitlementResolver, RlsRules } from './types'
import { checkRlsRead, checkRlsWrite, filterByRls } from './rls'
import { applyReadPolicy } from './apply-policy'

/**
 * Configuration for secure database wrappers.
 *
 * @template TCtx - The security context type
 * @template TReq - The entitlement requirements type
 * @template TTables - Record mapping table names to document types
 */
export type SecureDbConfig<TCtx, TReq, TTables extends Record<string, unknown>> = {
  /** RLS rules per table */
  rules?: RlsRules<TCtx, TTables>
  /** Entitlement resolver for FLS */
  resolver: EntitlementResolver<TCtx, TReq, unknown>
  /** Zod schemas per table (for FLS) */
  schemas?: Partial<Record<keyof TTables, z.ZodTypeAny>>
  /** Default deny reason for FLS */
  defaultDenyReason?: string
}

/**
 * A database interface that we wrap.
 * This is intentionally loose to work with Convex's DatabaseReader type.
 */
type DatabaseLike = {
  get: (id: any) => Promise<any>
  query: (table: any) => {
    filter: (fn: any) => {
      collect: () => Promise<any[]>
    }
  }
}

/**
 * A writable database interface.
 */
type WritableDatabaseLike = DatabaseLike & {
  insert: (table: any, doc: any) => Promise<string>
  patch: (id: any, patch: any) => Promise<void>
  delete: (id: any) => Promise<void>
}

/**
 * Create a secure database reader that applies RLS + FLS.
 *
 * The returned reader wraps the underlying database and:
 * 1. Checks RLS rules before returning documents
 * 2. Applies FLS transforms to sensitive fields
 *
 * @param db - The underlying database reader
 * @param ctx - The security context for the current request
 * @param config - Configuration including rules, resolver, and schemas
 * @returns A wrapped reader with secure get() and query() methods
 *
 * @example
 * ```ts
 * const rules = {
 *   posts: {
 *     read: (ctx, doc) => doc.isPublic || ctx.userId === doc.authorId
 *   }
 * }
 *
 * const reader = createSecureReader(ctx.db, securityCtx, { rules, resolver })
 * const post = await reader.get('posts', postId) // null if RLS denies
 * ```
 */
export function createSecureReader<TCtx, TReq, TTables extends Record<string, unknown>>(
  db: DatabaseLike,
  ctx: TCtx,
  config: SecureDbConfig<TCtx, TReq, TTables>
) {
  return {
    /**
     * Get a single document with RLS + FLS applied.
     *
     * @param table - The table name
     * @param id - The document ID
     * @returns The document (with FLS applied) or null if not found/denied
     */
    async get<TTable extends keyof TTables>(
      table: TTable,
      id: string
    ): Promise<TTables[TTable] | null> {
      const doc = await db.get(id)
      if (!doc) return null

      // Check RLS
      const rule = config.rules?.[table]
      const rlsResult = await checkRlsRead(ctx, doc, rule as any)
      if (!rlsResult.allowed) return null

      // Apply FLS
      const schema = config.schemas?.[table]
      if (schema) {
        return applyReadPolicy(doc, schema, ctx, config.resolver, {
          doc,
          defaultDenyReason: config.defaultDenyReason as any
        }) as Promise<TTables[TTable]>
      }

      return doc as TTables[TTable]
    },

    /**
     * Query documents with RLS + FLS applied.
     *
     * @param table - The table name
     * @param queryFn - Filter function for the query
     * @returns Array of documents (with FLS applied) that pass RLS
     */
    async query<TTable extends keyof TTables>(
      table: TTable,
      queryFn: (q: any) => any
    ): Promise<TTables[TTable][]> {
      const docs = await db
        .query(table as any)
        .filter(queryFn)
        .collect()

      // Filter by RLS
      const rule = config.rules?.[table]
      const filtered = await filterByRls(ctx, docs, rule as any)

      // Apply FLS to each
      const schema = config.schemas?.[table]
      if (schema) {
        return Promise.all(
          filtered.map(doc =>
            applyReadPolicy(doc, schema, ctx, config.resolver, {
              doc,
              defaultDenyReason: config.defaultDenyReason as any
            })
          )
        ) as Promise<TTables[TTable][]>
      }

      return filtered as TTables[TTable][]
    }
  }
}

/**
 * Create a secure database writer that applies RLS + write policy validation.
 *
 * The returned writer includes all reader methods plus:
 * - insert() - Checks insert RLS rule before inserting
 * - patch() - Checks update RLS rule before patching
 * - delete() - Checks delete RLS rule before deleting
 *
 * All write methods throw an error if RLS denies the operation.
 *
 * @param db - The underlying database writer
 * @param ctx - The security context for the current request
 * @param config - Configuration including rules, resolver, and schemas
 * @returns A wrapped writer with secure CRUD methods
 *
 * @example
 * ```ts
 * const rules = {
 *   posts: {
 *     insert: (ctx, doc) => ctx.isAuthenticated,
 *     update: (ctx, old, new_) => ctx.userId === old.authorId,
 *     delete: (ctx, doc) => ctx.role === 'admin'
 *   }
 * }
 *
 * const writer = createSecureWriter(ctx.db, securityCtx, { rules, resolver })
 *
 * try {
 *   await writer.insert('posts', newPost) // throws if RLS denies
 * } catch (e) {
 *   // Handle RLS denial
 * }
 * ```
 */
export function createSecureWriter<TCtx, TReq, TTables extends Record<string, unknown>>(
  db: WritableDatabaseLike,
  ctx: TCtx,
  config: SecureDbConfig<TCtx, TReq, TTables>
) {
  const reader = createSecureReader(db, ctx, config)

  return {
    ...reader,

    /**
     * Insert a document after RLS check.
     *
     * @param table - The table name
     * @param doc - The document to insert
     * @returns The ID of the inserted document
     * @throws Error if RLS denies the insert
     */
    async insert<TTable extends keyof TTables>(
      table: TTable,
      doc: TTables[TTable]
    ): Promise<string> {
      const rule = config.rules?.[table]
      const rlsResult = await checkRlsWrite(ctx, doc, rule as any, 'insert')
      if (!rlsResult.allowed) {
        throw new Error(`RLS denied insert on ${String(table)}: ${rlsResult.reason}`)
      }

      return db.insert(table as any, doc as any)
    },

    /**
     * Update a document after RLS check.
     *
     * The update rule receives both the old and new document versions.
     *
     * @param table - The table name
     * @param id - The document ID
     * @param patch - The fields to update
     * @throws Error if document not found or RLS denies the update
     */
    async patch<TTable extends keyof TTables>(
      table: TTable,
      id: string,
      patch: Partial<TTables[TTable]>
    ): Promise<void> {
      const oldDoc = await db.get(id)
      if (!oldDoc) throw new Error('Document not found')

      const newDoc = { ...oldDoc, ...patch }
      const rule = config.rules?.[table]
      const rlsResult = await checkRlsWrite(ctx, newDoc, rule as any, 'update', oldDoc)
      if (!rlsResult.allowed) {
        throw new Error(`RLS denied update on ${String(table)}: ${rlsResult.reason}`)
      }

      await db.patch(id, patch)
    },

    /**
     * Delete a document after RLS check.
     *
     * If the document doesn't exist, the operation silently succeeds
     * (idempotent delete).
     *
     * @param table - The table name
     * @param id - The document ID
     * @throws Error if RLS denies the delete
     */
    async delete<TTable extends keyof TTables>(table: TTable, id: string): Promise<void> {
      const doc = await db.get(id)
      if (!doc) return // Idempotent - doc doesn't exist

      const rule = config.rules?.[table]
      const rlsResult = await checkRlsWrite(ctx, doc, rule as any, 'delete')
      if (!rlsResult.allowed) {
        throw new Error(`RLS denied delete on ${String(table)}: ${rlsResult.reason}`)
      }

      await db.delete(id)
    }
  }
}
