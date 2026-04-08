/**
 * Schema helpers — Pure Zod utilities for union handling and system fields.
 *
 * This module contains helpers extracted from tables.ts that have NO server
 * dependencies (no convex/server, no convex-helpers/server). They are safe
 * to import from zodvex (client-side code).
 *
 * Used by:
 * - model.ts (defineZodModel) — client-safe model definitions
 * - tables.ts (zodTable) — server-side table definitions
 */

import { z } from 'zod'
import {
  $ZodArray,
  $ZodDiscriminatedUnion,
  $ZodNumber,
  $ZodObject,
  type $ZodShape,
  $ZodType,
  $ZodUnion,
  clone
} from './zod-core'
import { type ZxId, zx } from './zx'

// ============================================================================
// Types
// ============================================================================

/**
 * Helper type for Convex system fields added to documents
 */
export type SystemFields<TableName extends string> = {
  _id: ZxId<TableName>
  _creationTime: $ZodNumber
}

/**
 * Maps over union options, extending each ZodObject variant with system fields.
 * Non-object variants are preserved as-is.
 */
export type MapSystemFields<TableName extends string, Options extends readonly $ZodType[]> = {
  [K in keyof Options]: Options[K] extends z.ZodObject<infer Shape extends $ZodShape> // zod-ok
    ? z.ZodObject<Shape & SystemFields<TableName>> // zod-ok
    : Options[K]
}

/**
 * Core-compatible version of MapSystemFields.
 * Uses $ZodObject from zod/v4/core instead of z.ZodObject from full zod. // zod-ok
 */
export type MapSystemFieldsCore<TableName extends string, Options extends readonly $ZodType[]> = {
  [K in keyof Options]: Options[K] extends $ZodObject<infer Shape extends $ZodShape>
    ? $ZodObject<Shape & SystemFields<TableName>>
    : Options[K]
}

/**
 * Computes the result of adding system fields to a union/object schema.
 * Uses only $Zod* types from zod/v4/core — safe for shared code and mini consumers.
 *
 * Handles:
 * - $ZodObject → $ZodObject with system fields
 * - $ZodUnion → $ZodUnion with system fields on each variant
 * - $ZodDiscriminatedUnion → $ZodDiscriminatedUnion with system fields on each variant
 * - Other → returned as-is
 */
export type AddSystemFieldsToUnion<TableName extends string, Schema extends $ZodType> =
  Schema extends $ZodObject<infer Shape extends $ZodShape>
    ? $ZodObject<Shape & SystemFields<TableName>>
    : Schema extends $ZodUnion<infer Options extends readonly $ZodType[]>
      ? $ZodUnion<MapSystemFieldsCore<TableName, Options>>
      : Schema extends $ZodDiscriminatedUnion<
            infer Options extends readonly $ZodType[],
            infer Disc extends string
          >
        ? $ZodDiscriminatedUnion<MapSystemFieldsCore<TableName, Options>, Disc>
        : Schema

/**
 * Minimum tuple type required by z.union() - at least 2 elements.
 */
type UnionTuple<T extends $ZodType = $ZodType> = readonly [T, T, ...T[]]

// ============================================================================
// Union Helpers - Type-safe utilities for working with Zod unions
// ============================================================================

/** Full-zod union type alias used by isZodUnion/getUnionOptions — zod-ok by design. */
type AnyZodUnion =
  // zod-ok
  | z.ZodUnion<readonly $ZodType[]> // zod-ok
  | z.ZodDiscriminatedUnion<readonly z.ZodObject<$ZodShape>[], string> // zod-ok

/**
 * Type guard to check if a schema is a union type (ZodUnion or ZodDiscriminatedUnion).
 */
export function isZodUnion(schema: $ZodType): schema is AnyZodUnion {
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
export function getUnionOptions(schema: AnyZodUnion): readonly $ZodType[] {
  // $ZodDiscriminatedUnion extends $ZodUnion, so this covers both
  if (schema instanceof $ZodUnion) {
    return schema._zod.def.options
  }
  // cast: unreachable due to the union type constraint, but satisfies return type
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
// Return type alias — prevents z.ZodUnion on a {-ending line (formatter-safe). // zod-ok
type ZodUnionOf<T extends $ZodType> = z.ZodUnion<UnionTuple<T>> // zod-ok

export function createUnionFromOptions<T extends $ZodType>(options: readonly T[]): ZodUnionOf<T> {
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
  schema: z.ZodObject<Shape> // zod-ok
): z.ZodObject<Shape & SystemFields<TableName>> // zod-ok

// Overload 2: ZodUnion - maps system fields to each variant
export function addSystemFields<TableName extends string, Options extends readonly $ZodType[]>(
  tableName: TableName,
  schema: z.ZodUnion<Options> // zod-ok
): z.ZodUnion<MapSystemFields<TableName, Options>> // zod-ok

// Overload 3: ZodDiscriminatedUnion - maps system fields preserving discriminator
// Note: Zod v4 signature is ZodDiscriminatedUnion<Options, Discriminator>
export function addSystemFields<
  TableName extends string,
  Options extends readonly z.ZodObject<$ZodShape>[], // zod-ok
  Discriminator extends string
>(
  tableName: TableName,
  schema: z.ZodDiscriminatedUnion<Options, Discriminator> // zod-ok
): z.ZodDiscriminatedUnion<MapSystemFields<TableName, Options>, Discriminator> // zod-ok

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
        const newShape = {
          ...variant._zod.def.shape,
          _id: zx.id(tableName),
          _creationTime: z.number()
        }
        // Clone preserves the original's class + reinitializes with merged def
        return clone(variant, { ...variant._zod.def, shape: newShape })
      }
      // Non-object variants are returned as-is (shouldn't happen in practice)
      return variant
    })
    return createUnionFromOptions(extendedOptions)
  }

  // Handle object schemas — clone preserves class, checks, catchall, error
  if (schema instanceof $ZodObject) {
    const newShape = { ...schema._zod.def.shape, _id: zx.id(tableName), _creationTime: z.number() }
    return clone(schema, { ...schema._zod.def, shape: newShape })
  }

  // Fallback: return schema as-is
  return schema
}
