/**
 * Schema helpers — Pure Zod utilities for union handling and system fields.
 *
 * This module contains helpers extracted from tables.ts that have NO server
 * dependencies (no convex/server, no convex-helpers/server). They are safe
 * to import from zodvex/core (client-side code).
 *
 * Used by:
 * - model.ts (defineZodModel) — client-safe model definitions
 * - tables.ts (zodTable) — server-side table definitions
 */

import { z } from 'zod'
import { $ZodDiscriminatedUnion, $ZodObject, type $ZodShape, $ZodType, $ZodUnion } from './zod-core'
import { type ZxId, zx } from './zx'

// ============================================================================
// Types
// ============================================================================

/**
 * Helper type for Convex system fields added to documents
 */
export type SystemFields<TableName extends string> = {
  _id: ZxId<TableName>
  _creationTime: z.ZodNumber
}

/**
 * Maps over union options, extending each ZodObject variant with system fields.
 * Non-object variants are preserved as-is.
 */
export type MapSystemFields<TableName extends string, Options extends readonly $ZodType[]> = {
  [K in keyof Options]: Options[K] extends z.ZodObject<infer Shape extends $ZodShape>
    ? z.ZodObject<Shape & SystemFields<TableName>>
    : Options[K]
}

/**
 * Minimum tuple type required by z.union() - at least 2 elements.
 */
type UnionTuple<T extends $ZodType = $ZodType> = readonly [T, T, ...T[]]

// ============================================================================
// Union Helpers - Type-safe utilities for working with Zod unions
// ============================================================================

/**
 * Type guard to check if a schema is a union type (ZodUnion or ZodDiscriminatedUnion).
 */
export function isZodUnion(
  schema: $ZodType
): schema is
  | z.ZodUnion<readonly $ZodType[]>
  | z.ZodDiscriminatedUnion<readonly z.ZodObject<$ZodShape>[], string> {
  return schema instanceof $ZodUnion || schema instanceof $ZodDiscriminatedUnion
}

/**
 * Extracts the options array from a ZodUnion or ZodDiscriminatedUnion.
 * Both union types have an `.options` property, but TypeScript doesn't
 * create a common accessor after instanceof checks.
 *
 * @param schema - A ZodUnion or ZodDiscriminatedUnion schema
 * @returns The array of union variant schemas
 */
export function getUnionOptions(
  schema:
    | z.ZodUnion<readonly $ZodType[]>
    | z.ZodDiscriminatedUnion<readonly z.ZodObject<$ZodShape>[], string>
): readonly $ZodType[] {
  // Use ._zod.def.options for core compatibility (works with both zod and zod-mini)
  return (schema as any)._zod.def.options
}

/**
 * Asserts that an array has at least 2 elements, as required by z.union().
 * Throws an error if the array has fewer than 2 elements.
 *
 * @param options - Array of Zod schemas
 * @throws Error if array has fewer than 2 elements
 */
export function assertUnionOptions<T extends $ZodType>(
  options: readonly T[]
): asserts options is UnionTuple<T> {
  if (options.length < 2) {
    throw new Error(
      `z.union() requires at least 2 options, but received ${options.length}. ` +
        'This indicates an invalid union schema was passed to zodTable().'
    )
  }
}

/**
 * Creates a z.union() from an array of options with runtime validation.
 * Ensures the array has at least 2 elements as required by Zod.
 *
 * @param options - Array of Zod schemas (must have at least 2 elements)
 * @returns A ZodUnion schema
 * @throws Error if array has fewer than 2 elements
 */
export function createUnionFromOptions<T extends $ZodType>(
  options: readonly T[]
): z.ZodUnion<UnionTuple<T>> {
  assertUnionOptions(options)
  return z.union(options)
}

/**
 * Adds Convex system fields (_id, _creationTime) to a Zod schema.
 *
 * For object schemas: extends with system fields
 * For union schemas: adds system fields to each variant
 *
 * @param tableName - The Convex table name
 * @param schema - The Zod schema (object or union)
 * @returns Schema with system fields added
 */
// Overload 1: ZodObject - extends with system fields
export function addSystemFields<TableName extends string, Shape extends $ZodShape>(
  tableName: TableName,
  schema: z.ZodObject<Shape>
): z.ZodObject<Shape & SystemFields<TableName>>

// Overload 2: ZodUnion - maps system fields to each variant
export function addSystemFields<TableName extends string, Options extends readonly $ZodType[]>(
  tableName: TableName,
  schema: z.ZodUnion<Options>
): z.ZodUnion<MapSystemFields<TableName, Options>>

// Overload 3: ZodDiscriminatedUnion - maps system fields preserving discriminator
// Note: Zod v4 signature is ZodDiscriminatedUnion<Options, Discriminator>
export function addSystemFields<
  TableName extends string,
  Options extends readonly z.ZodObject<$ZodShape>[],
  Discriminator extends string
>(
  tableName: TableName,
  schema: z.ZodDiscriminatedUnion<Options, Discriminator>
): z.ZodDiscriminatedUnion<MapSystemFields<TableName, Options>, Discriminator>

// Overload 4: Fallback for other ZodTypes - returns as-is
export function addSystemFields<TableName extends string, S extends $ZodType>(
  tableName: TableName,
  schema: S
): S

// Implementation
export function addSystemFields<TableName extends string>(
  tableName: TableName,
  schema: $ZodType
): $ZodType {
  // Handle union schemas - add system fields to each variant
  if (isZodUnion(schema)) {
    const originalOptions = getUnionOptions(schema)
    const extendedOptions = originalOptions.map((variant: $ZodType) => {
      if (variant instanceof $ZodObject) {
        // Use shape spread instead of .extend() for zod-mini compatibility
        const shape = (variant as any)._zod.def.shape
        return z.object({ ...shape, _id: zx.id(tableName), _creationTime: z.number() })
      }
      // Non-object variants are returned as-is (shouldn't happen in practice)
      return variant
    })
    return createUnionFromOptions(extendedOptions)
  }

  // Handle object schemas — use shape spread for zod-mini compatibility
  if (schema instanceof $ZodObject) {
    const shape = (schema as any)._zod.def.shape
    let extended: any = z.object({ ...shape, _id: zx.id(tableName), _creationTime: z.number() })
    // Preserve object-level options (passthrough, strict, catchall)
    if ((schema as any)._zod.def.catchall) {
      extended = extended.catchall((schema as any)._zod.def.catchall)
    }
    return extended
  }

  // Fallback: return schema as-is
  return schema
}
