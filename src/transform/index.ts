/**
 * Transform layer - General-purpose schema traversal and value transformation utilities.
 *
 * This module provides primitives for:
 * - Walking Zod schemas (walkSchema, findFieldsWithMeta)
 * - Extracting metadata from schemas (getMetadata, hasMetadata)
 * - Recursively transforming values based on schema structure (transformBySchema, transformBySchemaAsync)
 *
 * @example
 * ```ts
 * import { findFieldsWithMeta, transformBySchema } from 'zodvex/transform'
 *
 * // Find all fields with custom metadata
 * const sensitiveFields = findFieldsWithMeta(schema, meta => meta?.sensitive === true)
 *
 * // Transform values based on metadata
 * const masked = transformBySchema(value, schema, ctx, (val, info) => {
 *   if (info.meta?.pii) return '[REDACTED]'
 *   return val
 * })
 * ```
 */

// Types
export type {
  FieldInfo,
  SchemaVisitor,
  WalkSchemaOptions,
  TransformContext,
  TransformFn,
  AsyncTransformFn,
  TransformOptions
} from './types'

// Traversal
export { getMetadata, hasMetadata, walkSchema, findFieldsWithMeta } from './traverse'

// Transformation
export { transformBySchema, transformBySchemaAsync } from './transform'
