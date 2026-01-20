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

// Transformation
export { transformBySchema, transformBySchemaAsync } from './transform'

// Traversal
export { findFieldsWithMeta, getMetadata, hasMetadata, walkSchema } from './traverse'
// Types
export type {
  AsyncTransformFn,
  FieldInfo,
  SchemaVisitor,
  TransformContext,
  TransformFn,
  TransformOptions,
  WalkSchemaOptions
} from './types'
