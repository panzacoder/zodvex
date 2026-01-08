/**
 * Secure function wrappers combining RLS + FLS.
 *
 * This module provides wrapper factories that create secure versions
 * of Convex query, mutation, and action handlers:
 *
 * - zSecureQuery - Queries with RLS filtering + FLS transforms
 * - zSecureMutation - Mutations with RLS checks
 * - zSecureAction - Actions with context resolution
 *
 * @example
 * ```ts
 * const secureQuery = zSecureQuery({
 *   resolveContext: async (ctx) => ({ userId: await getAuthUserId(ctx) }),
 *   resolver: async (ctx, req) => checkEntitlement(ctx.ctx, req),
 *   rules: { posts: { read: (ctx, doc) => doc.isPublic || ctx.userId === doc.authorId } },
 *   schemas: { posts: postSchema }
 * })
 *
 * export const getPost = secureQuery({
 *   args: z.object({ id: z.string() }),
 *   returns: postSchema.nullable(),
 *   handler: async (ctx, args) => ctx.db.get('posts', args.id)
 * })
 * ```
 */

import type { z } from 'zod'
import type { EntitlementResolver, RlsRules } from './types'
import { createSecureReader, createSecureWriter } from './db'
import { applyReadPolicy } from './apply-policy'

/**
 * Configuration for secure function wrappers (queries and mutations).
 *
 * @template TCtx - The security context type
 * @template TReq - The entitlement requirements type
 */
export type SecureConfig<TCtx, TReq> = {
  /** Transform Convex context to your security context */
  resolveContext: (ctx: ConvexContext) => TCtx | Promise<TCtx>
  /** Entitlement resolver for FLS */
  resolver: EntitlementResolver<TCtx, TReq, unknown>
  /** Optional RLS rules */
  rules?: RlsRules<TCtx, any>
  /** Zod schemas for FLS */
  schemas?: Record<string, z.ZodTypeAny>
  /** Optional authorization check before handler */
  authorize?: (ctx: TCtx, args: unknown) => void | Promise<void>
  /** Optional audit callbacks */
  audit?: {
    onRead?: (ctx: TCtx, table: string, ids: string[]) => void | Promise<void>
    onWrite?: (ctx: TCtx, table: string, operation: string, id: string) => void | Promise<void>
  }
  /** Custom error for denied operations */
  onDenied?: (info: { operation: string; reason?: string }) => Error
  /** Default deny reason */
  defaultDenyReason?: string
}

/**
 * Configuration for secure action wrappers.
 *
 * Unlike queries and mutations, actions don't have direct DB access,
 * so RLS/FLS configuration is not applicable at the action level.
 * Security for underlying queries/mutations should be handled there.
 *
 * @template TCtx - The security context type
 */
export type SecureActionConfig<TCtx> = {
  /** Transform Convex context to your security context */
  resolveContext: (ctx: ConvexContext) => TCtx | Promise<TCtx>
  /** Optional authorization check before handler */
  authorize?: (ctx: TCtx, args: unknown) => void | Promise<void>
}

// Minimal Convex context types (we're intentionally loose here)
type ConvexContext = {
  db?: DatabaseLike | WritableDatabaseLike
  runQuery?: (...args: any[]) => Promise<any>
  runMutation?: (...args: any[]) => Promise<any>
}

type DatabaseLike = {
  get: (id: any) => Promise<any>
  query: (table: any) => any
}

type WritableDatabaseLike = DatabaseLike & {
  insert: (table: any, doc: any) => Promise<string>
  patch: (id: any, patch: any) => Promise<void>
  delete: (id: any) => Promise<void>
}

/**
 * Create a secure query builder.
 *
 * The returned factory creates query handlers that:
 * 1. Resolve security context from Convex context
 * 2. Run optional authorization check
 * 3. Provide a secure db reader with RLS + FLS
 * 4. Apply FLS transforms to the return value
 *
 * @param config - Security configuration
 * @returns A factory function for defining secure queries
 *
 * @example
 * ```ts
 * const secureQuery = zSecureQuery({
 *   resolveContext: async (ctx) => ({ userId: await getAuthUserId(ctx) }),
 *   resolver: async (ctx, requirement) => ctx.ctx.userId === requirement.ownerId,
 *   schemas: { users: userSchema }
 * })
 *
 * export const getUser = secureQuery({
 *   args: z.object({ id: z.string() }),
 *   returns: userSchema,
 *   handler: async (ctx, args) => ctx.db.get('users', args.id)
 * })
 * ```
 */
export function zSecureQuery<TCtx, TReq = unknown>(config: SecureConfig<TCtx, TReq>) {
  return function defineSecureQuery<
    TArgs extends z.ZodTypeAny,
    TReturns extends z.ZodTypeAny
  >(definition: {
    args: TArgs
    returns: TReturns
    handler: (
      ctx: { db: ReturnType<typeof createSecureReader>; securityCtx: TCtx },
      args: z.infer<TArgs>
    ) => Promise<z.infer<TReturns>>
  }) {
    return {
      args: definition.args,
      returns: definition.returns,
      handler: async (convexCtx: ConvexContext, args: z.infer<TArgs>) => {
        const securityCtx = await config.resolveContext(convexCtx)

        // Optional authorization
        if (config.authorize) {
          await config.authorize(securityCtx, args)
        }

        // Create secure db reader
        const db = createSecureReader(convexCtx.db as DatabaseLike, securityCtx, {
          rules: config.rules,
          resolver: config.resolver,
          schemas: config.schemas,
          defaultDenyReason: config.defaultDenyReason
        })

        // Run handler
        const result = await definition.handler({ db, securityCtx }, args)

        // Apply FLS to return value
        return applyReadPolicy(result, definition.returns, securityCtx, config.resolver, {
          defaultDenyReason: config.defaultDenyReason
        })
      }
    }
  }
}

/**
 * Create a secure mutation builder.
 *
 * The returned factory creates mutation handlers that:
 * 1. Resolve security context from Convex context
 * 2. Run optional authorization check
 * 3. Provide a secure db writer with RLS checks
 *
 * @param config - Security configuration
 * @returns A factory function for defining secure mutations
 *
 * @example
 * ```ts
 * const secureMutation = zSecureMutation({
 *   resolveContext: async (ctx) => ({ userId: await getAuthUserId(ctx) }),
 *   resolver: async (ctx, requirement) => checkPermission(ctx.ctx, requirement),
 *   rules: {
 *     posts: {
 *       insert: (ctx, doc) => ctx.userId === doc.authorId,
 *       update: (ctx, old, new_) => ctx.userId === old.authorId,
 *       delete: (ctx, doc) => ctx.role === 'admin'
 *     }
 *   }
 * })
 *
 * export const createPost = secureMutation({
 *   args: z.object({ title: z.string() }),
 *   returns: z.string(),
 *   handler: async (ctx, args) => {
 *     return ctx.db.insert('posts', { ...args, authorId: ctx.securityCtx.userId })
 *   }
 * })
 * ```
 */
export function zSecureMutation<TCtx, TReq = unknown>(config: SecureConfig<TCtx, TReq>) {
  return function defineSecureMutation<
    TArgs extends z.ZodTypeAny,
    TReturns extends z.ZodTypeAny
  >(definition: {
    args: TArgs
    returns: TReturns
    handler: (
      ctx: { db: ReturnType<typeof createSecureWriter>; securityCtx: TCtx },
      args: z.infer<TArgs>
    ) => Promise<z.infer<TReturns>>
  }) {
    return {
      args: definition.args,
      returns: definition.returns,
      handler: async (convexCtx: ConvexContext, args: z.infer<TArgs>) => {
        const securityCtx = await config.resolveContext(convexCtx)

        if (config.authorize) {
          await config.authorize(securityCtx, args)
        }

        const db = createSecureWriter(convexCtx.db as WritableDatabaseLike, securityCtx, {
          rules: config.rules,
          resolver: config.resolver,
          schemas: config.schemas,
          defaultDenyReason: config.defaultDenyReason
        })

        return definition.handler({ db, securityCtx }, args)
      }
    }
  }
}

/**
 * Create a secure action builder.
 *
 * The returned factory creates action handlers that:
 * 1. Resolve security context from Convex context
 * 2. Run optional authorization check
 * 3. Provide the security context and Convex's runQuery/runMutation
 *
 * Unlike queries and mutations, actions don't have direct DB access,
 * so no RLS/FLS is applied at this level. Security for the underlying
 * queries/mutations should be handled there.
 *
 * @param config - Security configuration
 * @returns A factory function for defining secure actions
 *
 * @example
 * ```ts
 * const secureAction = zSecureAction({
 *   resolveContext: async (ctx) => ({ userId: await getAuthUserId(ctx) }),
 *   resolver: async () => true,
 *   authorize: async (ctx) => {
 *     if (!ctx.userId) throw new Error('Unauthorized')
 *   }
 * })
 *
 * export const sendEmail = secureAction({
 *   args: z.object({ to: z.string(), subject: z.string() }),
 *   returns: z.void(),
 *   handler: async (ctx, args) => {
 *     // Use ctx.runQuery/ctx.runMutation for DB operations
 *     await externalEmailService.send(args)
 *   }
 * })
 * ```
 */
export function zSecureAction<TCtx>(config: SecureActionConfig<TCtx>) {
  return function defineSecureAction<
    TArgs extends z.ZodTypeAny,
    TReturns extends z.ZodTypeAny
  >(definition: {
    args: TArgs
    returns: TReturns
    handler: (
      ctx: {
        securityCtx: TCtx
        runQuery: (...args: any[]) => Promise<any>
        runMutation: (...args: any[]) => Promise<any>
      },
      args: z.infer<TArgs>
    ) => Promise<z.infer<TReturns>>
  }) {
    return {
      args: definition.args,
      returns: definition.returns,
      handler: async (convexCtx: ConvexContext, args: z.infer<TArgs>) => {
        const securityCtx = await config.resolveContext(convexCtx)

        if (config.authorize) {
          await config.authorize(securityCtx, args)
        }

        return definition.handler(
          {
            securityCtx,
            runQuery: convexCtx.runQuery!,
            runMutation: convexCtx.runMutation!
          },
          args
        )
      }
    }
  }
}
