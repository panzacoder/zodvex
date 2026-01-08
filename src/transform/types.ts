/**
 * Transform layer type definitions.
 *
 * General-purpose types for schema traversal and value transformation.
 */

import type { z } from 'zod'

/**
 * Information about a field during schema traversal.
 */
export type FieldInfo = {
  /** Dot-notation path (e.g., 'profile.email', 'contacts[].email') */
  path: string
  /** The Zod schema for this field */
  schema: z.ZodTypeAny
  /** Metadata from schema.meta() if present */
  meta: Record<string, unknown> | undefined
  /** Whether the field is wrapped in optional/nullable */
  isOptional: boolean
}

/**
 * Visitor functions for walkSchema().
 */
export type SchemaVisitor = {
  /** Called for every field. Return 'skip' to skip children. */
  onField?: (info: FieldInfo) => void | 'skip'
  /** Called when entering an object schema */
  onObject?: (info: FieldInfo) => void
  /** Called when entering an array schema */
  onArray?: (info: FieldInfo) => void
  /** Called when entering a union schema */
  onUnion?: (info: FieldInfo, variants: z.ZodTypeAny[]) => void
}

/**
 * Options for walkSchema().
 */
export type WalkSchemaOptions = {
  /** Starting path prefix */
  path?: string
}

/**
 * Context passed to transform functions.
 */
export type TransformContext<TCtx = unknown> = {
  /** Current field path */
  path: string
  /** The Zod schema for this field */
  schema: z.ZodTypeAny
  /** Metadata from schema.meta() if present */
  meta: Record<string, unknown> | undefined
  /** User-provided context */
  ctx: TCtx
}

/**
 * Synchronous transform function signature.
 */
export type TransformFn<TCtx = unknown> = (
  value: unknown,
  context: TransformContext<TCtx>
) => unknown

/**
 * Async transform function signature.
 */
export type AsyncTransformFn<TCtx = unknown> = (
  value: unknown,
  context: TransformContext<TCtx>
) => unknown | Promise<unknown>

/**
 * Options for transformBySchema().
 */
export type TransformOptions<TCtx = unknown> = {
  /** Starting path prefix */
  path?: string
  /**
   * How to handle values that don't match any union variant.
   * - 'passthrough': Return value unchanged (default)
   * - 'error': Throw an error
   * - 'null': Replace with null (fail-closed for security)
   */
  unmatchedUnion?: 'passthrough' | 'error' | 'null'
  /** Callback when a union doesn't match */
  onUnmatchedUnion?: (path: string) => void
}
