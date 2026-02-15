import { defineTable } from 'convex/server'
import type { GenericId } from 'convex/values'
import { Table } from 'convex-helpers/server'
import { z } from 'zod'
import { type ConvexValidatorFromZodFieldsAuto, zodToConvex, zodToConvexFields } from './mapping'
import type { ZodvexWireSchema } from './types'
import { type ZxId, zx } from './zx'

// ============================================================================
// Wire Format Helpers - Convert codec schemas to their wire (storage) schemas
// ============================================================================

/**
 * Recursively replaces codec schemas with their wire (input) schemas at the type level.
 * Used to ensure doc/docArray types match what Convex actually stores in the database.
 *
 * For example, `zx.date()` (ZodCodec<ZodNumber, ZodCustom<Date>>) becomes `ZodNumber`,
 * so `z.infer<doc>` gives `number` instead of `Date`, matching what `ctx.db.query()` returns.
 */
type ToWireField<Z extends z.ZodTypeAny> =
  // Handle branded zodvex codecs (zx.date(), zx.codec(), etc.)
  Z extends { readonly [ZodvexWireSchema]: infer W extends z.ZodTypeAny }
    ? W
    : // Handle native Zod codecs
      Z extends z.ZodCodec<infer W extends z.ZodTypeAny, any>
      ? W
      : // Recurse into optionals
        Z extends z.ZodOptional<infer Inner extends z.ZodTypeAny>
        ? z.ZodOptional<ToWireField<Inner>>
        : // Recurse into nullables
          Z extends z.ZodNullable<infer Inner extends z.ZodTypeAny>
          ? z.ZodNullable<ToWireField<Inner>>
          : // Recurse into defaults
            Z extends z.ZodDefault<infer Inner extends z.ZodTypeAny>
            ? z.ZodDefault<ToWireField<Inner>>
            : // Recurse into arrays
              Z extends z.ZodArray<infer E extends z.ZodTypeAny>
              ? z.ZodArray<ToWireField<E>>
              : // Recurse into objects
                Z extends z.ZodObject<infer S extends z.ZodRawShape>
                ? z.ZodObject<ToWireShape<S>>
                : // All other types pass through unchanged
                  Z

/**
 * Applies ToWireField to every field in a Zod object shape.
 */
type ToWireShape<Shape extends z.ZodRawShape> = {
  [K in keyof Shape]: Shape[K] extends z.ZodTypeAny ? ToWireField<Shape[K]> : Shape[K]
}

/**
 * Recursively replaces ZodCodec instances with their wire (input) schemas at runtime.
 * This ensures doc/docArray schemas validate wire-format data (e.g., numbers for dates)
 * rather than runtime-format data (e.g., Date objects).
 *
 * @param field - A Zod schema that may contain codecs
 * @returns The equivalent schema with codecs replaced by their wire schemas
 */
function toWireField(field: z.ZodTypeAny): z.ZodTypeAny {
  // Handle codecs - extract wire (input) schema
  if (field instanceof z.ZodCodec) {
    const wireSchema = (field as any).def?.in
    if (wireSchema && wireSchema instanceof z.ZodType) {
      return wireSchema
    }
    return field
  }

  // Recurse into optionals
  if (field instanceof z.ZodOptional) {
    return toWireField(field.unwrap() as z.ZodTypeAny).optional()
  }

  // Fallback for optionals that don't pass instanceof
  // (can happen with codec.optional() in some Zod v4 edge cases)
  if (!(field instanceof z.ZodOptional) && (field as any).def?.type === 'optional') {
    const innerType = (field as any).def?.innerType ?? (field as any).unwrap?.()
    if (innerType && innerType instanceof z.ZodType) {
      return toWireField(innerType).optional()
    }
  }

  // Recurse into nullables
  if (field instanceof z.ZodNullable) {
    return toWireField(field.unwrap() as z.ZodTypeAny).nullable()
  }

  // Recurse into defaults
  if (field instanceof z.ZodDefault) {
    const inner = (field as any).def?.innerType
    if (inner && inner instanceof z.ZodType) {
      const defaultValue = (field as any).def?.defaultValue
      return toWireField(inner).default(defaultValue)
    }
    return field
  }

  // Recurse into arrays
  if (field instanceof z.ZodArray) {
    return z.array(toWireField(field.element as z.ZodTypeAny))
  }

  // Recurse into objects
  if (field instanceof z.ZodObject) {
    return z.object(toWireShape(field.shape))
  }

  // All other types pass through unchanged
  return field
}

/**
 * Converts all fields in a Zod object shape to their wire-format equivalents.
 *
 * @param shape - A Zod object shape potentially containing codecs
 * @returns A new shape with codecs replaced by their wire schemas
 */
function toWireShape(shape: z.ZodRawShape): z.ZodRawShape {
  const wireShape: Record<string, z.ZodTypeAny> = {}
  for (const [key, value] of Object.entries(shape)) {
    wireShape[key] = toWireField(value as z.ZodTypeAny)
  }
  return wireShape as z.ZodRawShape
}

/**
 * Makes all properties of a Zod object shape optional.
 */
type PartialShape<Shape extends z.ZodRawShape> = {
  [K in keyof Shape]: z.ZodOptional<Shape[K]>
}

/**
 * Helper type for Convex system fields added to documents
 */
type SystemFields<TableName extends string> = {
  _id: ZxId<TableName>
  _creationTime: z.ZodNumber
}

/**
 * Maps over union options, extending each ZodObject variant with system fields.
 * Converts codec fields to wire format for doc/docArray type compatibility.
 * Non-object variants are preserved as-is.
 */
type MapSystemFields<TableName extends string, Options extends readonly z.ZodTypeAny[]> = {
  [K in keyof Options]: Options[K] extends z.ZodObject<infer Shape extends z.ZodRawShape>
    ? z.ZodObject<ToWireShape<Shape> & SystemFields<TableName>>
    : Options[K]
}

// ============================================================================
// Union Helpers - Type-safe utilities for working with Zod unions
// ============================================================================

/**
 * Type guard to check if a schema is a union type (ZodUnion or ZodDiscriminatedUnion).
 */
export function isZodUnion(
  schema: z.ZodTypeAny
): schema is
  | z.ZodUnion<readonly z.ZodTypeAny[]>
  | z.ZodDiscriminatedUnion<readonly z.ZodObject<z.ZodRawShape>[], string> {
  return schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion
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
    | z.ZodUnion<readonly z.ZodTypeAny[]>
    | z.ZodDiscriminatedUnion<readonly z.ZodObject<z.ZodRawShape>[], string>
): readonly z.ZodTypeAny[] {
  // Both ZodUnion and ZodDiscriminatedUnion have .options getter
  // This is safe because we've constrained the input type
  return schema.options
}

/**
 * Minimum tuple type required by z.union() - at least 2 elements.
 */
type UnionTuple<T extends z.ZodTypeAny = z.ZodTypeAny> = readonly [T, T, ...T[]]

/**
 * Asserts that an array has at least 2 elements, as required by z.union().
 * Throws an error if the array has fewer than 2 elements.
 *
 * @param options - Array of Zod schemas
 * @throws Error if array has fewer than 2 elements
 */
export function assertUnionOptions<T extends z.ZodTypeAny>(
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
export function createUnionFromOptions<T extends z.ZodTypeAny>(
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
// Overload 1: ZodObject - extends with system fields (wire format)
export function addSystemFields<TableName extends string, Shape extends z.ZodRawShape>(
  tableName: TableName,
  schema: z.ZodObject<Shape>
): z.ZodObject<ToWireShape<Shape> & SystemFields<TableName>>

// Overload 2: ZodUnion - maps system fields to each variant
export function addSystemFields<TableName extends string, Options extends readonly z.ZodTypeAny[]>(
  tableName: TableName,
  schema: z.ZodUnion<Options>
): z.ZodUnion<MapSystemFields<TableName, Options>>

// Overload 3: ZodDiscriminatedUnion - maps system fields preserving discriminator
// Note: Zod v4 signature is ZodDiscriminatedUnion<Options, Discriminator>
export function addSystemFields<
  TableName extends string,
  Options extends readonly z.ZodObject<z.ZodRawShape>[],
  Discriminator extends string
>(
  tableName: TableName,
  schema: z.ZodDiscriminatedUnion<Options, Discriminator>
): z.ZodDiscriminatedUnion<MapSystemFields<TableName, Options>, Discriminator>

// Overload 4: Fallback for other ZodTypes - returns as-is
export function addSystemFields<TableName extends string, S extends z.ZodTypeAny>(
  tableName: TableName,
  schema: S
): S

// Implementation
export function addSystemFields<TableName extends string>(
  tableName: TableName,
  schema: z.ZodTypeAny
): z.ZodTypeAny {
  // Handle union schemas - add system fields to each variant (wire format)
  if (isZodUnion(schema)) {
    const originalOptions = getUnionOptions(schema)
    const extendedOptions = originalOptions.map((variant: z.ZodTypeAny) => {
      if (variant instanceof z.ZodObject) {
        const wireShape = toWireShape(variant.shape)
        let variantDoc = z.object({
          ...wireShape,
          _id: zx.id(tableName),
          _creationTime: z.number()
        })
        // Preserve object-level options
        const catchall = (variant as any).def?.catchall
        if (catchall) {
          variantDoc = variantDoc.catchall(catchall)
        }
        return variantDoc
      }
      // Non-object variants are returned as-is (shouldn't happen in practice)
      return variant
    })
    return createUnionFromOptions(extendedOptions)
  }

  // Handle object schemas (wire format)
  if (schema instanceof z.ZodObject) {
    const wireShape = toWireShape(schema.shape)
    let docSchema = z.object({
      ...wireShape,
      _id: zx.id(tableName),
      _creationTime: z.number()
    })
    // Preserve object-level options
    const catchall = (schema as any).def?.catchall
    if (catchall) {
      docSchema = docSchema.catchall(catchall)
    }
    return docSchema
  }

  // Fallback: return schema as-is
  return schema
}

/**
 * System fields added to Convex documents.
 */
type DocSystemFields<TableName extends string> = {
  _id: ZxId<TableName>
  _creationTime: z.ZodNumber
}
/**
 * Type for validators that can be used with Convex's defineTable.
 *
 * Convex's defineTable expects Validator<Record<string, any>, "required", any>,
 * but zodToConvex returns more specific types that TypeScript can't verify are
 * compatible. This type represents validators that produce object documents.
 *
 * @internal
 */
type TableValidator = Parameters<typeof defineTable>[0]

/**
 * Asserts that a Convex validator can be used to define a table.
 *
 * This is needed because zodToConvex returns a specific validator type (like VUnion)
 * that TypeScript can't verify is assignable to defineTable's expected input type,
 * even though all union variants are objects that produce Record<string, any>.
 *
 * The runtime behavior is correct - Convex supports union validators in tables.
 * This is purely a TypeScript limitation with complex mapped types.
 *
 * @internal
 */
function asTableValidator<V extends { kind: string }>(validator: V): TableValidator {
  return validator as unknown as TableValidator
}

/**
 * Creates a Zod schema for a Convex document with system fields.
 * Converts codec fields (e.g., zx.date()) to their wire-format schemas so that
 * `z.infer<doc>` matches what Convex actually stores and returns from queries.
 * Preserves object-level options (.passthrough(), .strict(), .catchall()) from
 * the original schema.
 *
 * @param tableName - The Convex table name
 * @param schema - The Zod object schema for user fields
 * @returns A Zod object schema with wire-format fields, _id, and _creationTime
 */
export function zodDoc<TableName extends string, Shape extends z.ZodRawShape>(
  tableName: TableName,
  schema: z.ZodObject<Shape>
): z.ZodObject<ToWireShape<Shape> & DocSystemFields<TableName>> {
  const wireShape = toWireShape(schema.shape as z.ZodRawShape)
  let docSchema = z.object({
    ...wireShape,
    _id: zx.id(tableName),
    _creationTime: z.number()
  })

  // Preserve object-level options (passthrough/strict/catchall) from original schema
  const catchall = (schema as any).def?.catchall
  if (catchall) {
    docSchema = docSchema.catchall(catchall)
  }

  return docSchema as z.ZodObject<ToWireShape<Shape> & DocSystemFields<TableName>>
}

// Helper to create nullable doc schema
export function zodDocOrNull<
  TableName extends string,
  Shape extends z.ZodRawShape,
  Schema extends z.ZodObject<Shape>
>(tableName: TableName, schema: Schema) {
  return z.union([zodDoc(tableName, schema), z.null()])
}

/**
 * Helper to detect if input is an object shape (plain object with Zod validators)
 */
function isObjectShape(input: any): input is Record<string, z.ZodTypeAny> {
  // Check if it's a plain object (not a Zod instance)
  if (!input || typeof input !== 'object') return false

  // If it's a Zod instance, it's not an object shape
  if (input instanceof z.ZodType) return false

  // Check if all values are Zod types
  for (const key in input) {
    if (!(input[key] instanceof z.ZodType)) {
      return false
    }
  }

  return true
}

/**
 * Defines a Convex table using either:
 * - A raw Zod shape (an object mapping field names to Zod types)
 * - A Zod union schema (for polymorphic tables)
 *
 * For object shapes, this function intentionally accepts a raw shape instead of a ZodObject instance.
 * Accepting raw shapes allows TypeScript to infer field types more accurately and efficiently,
 * leading to better type inference and performance throughout the codebase.
 *
 * For union schemas, this enables polymorphic tables with discriminated unions.
 *
 * Returns the Table definition along with Zod schemas for documents and arrays.
 *
 * @param name - The table name
 * @param schemaOrShape - Either a raw object shape or a Zod union schema
 * @returns A Table with attached helpers (shape, schema, zDoc, docArray, withSystemFields)
 *
 * @example Object shape
 * ```ts
 * const Users = zodTable('users', {
 *   name: z.string(),
 *   email: z.string().email(),
 *   age: z.number().optional()
 * })
 *
 * // Use in schema
 * export default defineSchema({ users: Users.table })
 *
 * // Use for return types
 * export const getUsers = zQuery(query, {},
 *   async (ctx) => ctx.db.query('users').collect(),
 *   { returns: Users.docArray }
 * )
 * ```
 *
 * @example Union schema (polymorphic table)
 * ```ts
 * const shapeSchema = z.union([
 *   z.object({ kind: z.literal('circle'), r: z.number() }),
 *   z.object({ kind: z.literal('rectangle'), width: z.number() })
 * ])
 *
 * const Shapes = zodTable('shapes', shapeSchema)
 *
 * // Use in schema
 * export default defineSchema({ shapes: Shapes.table })
 *
 * // Use for return types with system fields
 * export const getShapes = zQuery(query, {},
 *   async (ctx) => ctx.db.query('shapes').collect(),
 *   { returns: Shapes.docArray }
 * )
 * ```
 */
// Helper type to compute the result of addSystemFields for use in zodTable return type
// Uses ToWireShape to ensure doc types match what Convex stores (wire format)
type AddSystemFieldsResult<
  TableName extends string,
  Schema extends z.ZodTypeAny
> = Schema extends z.ZodObject<infer Shape extends z.ZodRawShape>
  ? z.ZodObject<ToWireShape<Shape> & SystemFields<TableName>>
  : Schema extends z.ZodUnion<infer Options extends readonly z.ZodTypeAny[]>
    ? z.ZodUnion<MapSystemFields<TableName, Options>>
    : Schema extends z.ZodDiscriminatedUnion<
          infer Options extends readonly z.ZodObject<z.ZodRawShape>[],
          infer Disc extends string
        >
      ? z.ZodDiscriminatedUnion<MapSystemFields<TableName, Options>, Disc>
      : Schema

/**
 * Update schema shape: _id required, _creationTime optional, user fields partial
 */
type UpdateShape<TableName extends string, Shape extends z.ZodRawShape> = {
  _id: ZxId<TableName>
  _creationTime: z.ZodOptional<z.ZodNumber>
} & PartialShape<Shape>

/**
 * Maps over union options for update schema.
 * Each variant gets _id required, _creationTime optional, and user fields partial.
 */
type MapUpdateVariants<TableName extends string, Options extends readonly z.ZodTypeAny[]> = {
  [K in keyof Options]: Options[K] extends z.ZodObject<infer Shape extends z.ZodRawShape>
    ? z.ZodObject<UpdateShape<TableName, Shape>>
    : Options[K]
}

/**
 * Computes the update schema type for a given schema.
 * Includes _id (required), _creationTime (optional), and partial user fields.
 * For unions: each variant gets update shape
 * For objects: the whole object gets update shape
 * For other types: returns as-is
 */
type UpdateSchemaType<
  TableName extends string,
  Schema extends z.ZodTypeAny
> = Schema extends z.ZodUnion<infer Options extends readonly z.ZodTypeAny[]>
  ? z.ZodUnion<MapUpdateVariants<TableName, Options>>
  : Schema extends z.ZodDiscriminatedUnion<
        infer Options extends readonly z.ZodObject<z.ZodRawShape>[],
        infer _Disc extends string
      >
    ? z.ZodUnion<MapUpdateVariants<TableName, Options>>
    : Schema extends z.ZodObject<infer Shape extends z.ZodRawShape>
      ? z.ZodObject<UpdateShape<TableName, Shape>>
      : Schema

// Overload 1: Object shape (most common case - raw object with Zod validators)
export function zodTable<TableName extends string, Shape extends Record<string, z.ZodTypeAny>>(
  name: TableName,
  shape: Shape
): ReturnType<typeof Table<ConvexValidatorFromZodFieldsAuto<Shape>, TableName>> & {
  shape: Shape
  /** @deprecated Use `schema.doc` instead */
  zDoc: z.ZodObject<
    ToWireShape<Shape> & {
      _id: ZxId<TableName>
      _creationTime: z.ZodNumber
    }
  >
  /** @deprecated Use `schema.docArray` instead */
  docArray: z.ZodArray<
    z.ZodObject<
      ToWireShape<Shape> & {
        _id: ZxId<TableName>
        _creationTime: z.ZodNumber
      }
    >
  >
  schema: {
    doc: z.ZodObject<
      ToWireShape<Shape> & {
        _id: ZxId<TableName>
        _creationTime: z.ZodNumber
      }
    >
    docArray: z.ZodArray<
      z.ZodObject<
        ToWireShape<Shape> & {
          _id: ZxId<TableName>
          _creationTime: z.ZodNumber
        }
      >
    >
    /** The base schema - user fields without system fields */
    base: z.ZodObject<Shape>
    /** Alias for base - user fields for insert operations */
    insert: z.ZodObject<Shape>
    /** Update schema - _id required, _creationTime optional, user fields partial */
    update: z.ZodObject<UpdateShape<TableName, Shape>>
  }
}

// Overload 2: ZodObject wrapper (extracts shape for same type inference as raw shape)
export function zodTable<TableName extends string, Shape extends z.ZodRawShape>(
  name: TableName,
  schema: z.ZodObject<Shape>
): ReturnType<typeof Table<ConvexValidatorFromZodFieldsAuto<Shape>, TableName>> & {
  shape: Shape
  /** @deprecated Use `schema.doc` instead */
  zDoc: z.ZodObject<
    ToWireShape<Shape> & {
      _id: ZxId<TableName>
      _creationTime: z.ZodNumber
    }
  >
  /** @deprecated Use `schema.docArray` instead */
  docArray: z.ZodArray<
    z.ZodObject<
      ToWireShape<Shape> & {
        _id: ZxId<TableName>
        _creationTime: z.ZodNumber
      }
    >
  >
  schema: {
    doc: z.ZodObject<
      ToWireShape<Shape> & {
        _id: ZxId<TableName>
        _creationTime: z.ZodNumber
      }
    >
    docArray: z.ZodArray<
      z.ZodObject<
        ToWireShape<Shape> & {
          _id: ZxId<TableName>
          _creationTime: z.ZodNumber
        }
      >
    >
    /** The base schema - user fields without system fields */
    base: z.ZodObject<Shape>
    /** Alias for base - user fields for insert operations */
    insert: z.ZodObject<Shape>
    /** Update schema - _id required, _creationTime optional, user fields partial */
    update: z.ZodObject<UpdateShape<TableName, Shape>>
  }
}

// Overload 3: Union/schema types
export function zodTable<TableName extends string, Schema extends z.ZodTypeAny>(
  name: TableName,
  schema: Schema
): {
  table: ReturnType<typeof defineTable>
  tableName: TableName
  validator: ReturnType<typeof zodToConvex<Schema>>
  schema: {
    doc: AddSystemFieldsResult<TableName, Schema>
    docArray: z.ZodArray<AddSystemFieldsResult<TableName, Schema>>
    /** The base schema - user fields without system fields */
    base: Schema
    /** Alias for base - user fields for insert operations */
    insert: Schema
    /** Update schema - _id required, _creationTime optional, user fields partial */
    update: UpdateSchemaType<TableName, Schema>
  }
  /** @deprecated Use `schema.docArray` instead */
  docArray: z.ZodArray<AddSystemFieldsResult<TableName, Schema>>
  withSystemFields: () => AddSystemFieldsResult<TableName, Schema>
}

export function zodTable<
  TableName extends string,
  SchemaOrShape extends z.ZodTypeAny | Record<string, z.ZodTypeAny>
>(name: TableName, schemaOrShape: SchemaOrShape): any {
  // Detect if it's an object shape, ZodObject, or other schema
  // For ZodObject: extract its shape to use the type-preserving path
  const isZodObject = schemaOrShape instanceof z.ZodObject
  if (isObjectShape(schemaOrShape) || isZodObject) {
    // Extract shape from ZodObject or use raw shape directly
    const shape = isZodObject
      ? (schemaOrShape as z.ZodObject<z.ZodRawShape>).shape
      : (schemaOrShape as Record<string, z.ZodTypeAny>)

    // Convert fields with proper types
    const convexFields = zodToConvexFields(shape) as ConvexValidatorFromZodFieldsAuto<typeof shape>

    // Create the Table from convex-helpers with explicit type
    const table = Table<ConvexValidatorFromZodFieldsAuto<typeof shape>, TableName>(
      name,
      convexFields
    )

    // Create base schema (user fields only, no system fields)
    // When a ZodObject is passed, preserve it to maintain options like .passthrough(), .strict(), .catchall()
    const baseSchema = isZodObject ? (schemaOrShape as z.ZodObject<z.ZodRawShape>) : z.object(shape)

    // Create zDoc schema with system fields
    // Uses .extend() which preserves object-level options from baseSchema
    const zDoc = zodDoc(name, baseSchema as z.ZodObject<z.ZodRawShape>)

    // Create docArray helper for return types
    const docArray = z.array(zDoc)

    // Create partial shape for user fields
    const partialShape: Record<string, z.ZodTypeAny> = {}
    for (const [key, value] of Object.entries(shape)) {
      partialShape[key] = (value as z.ZodTypeAny).optional()
    }

    // Create update schema: _id required, _creationTime optional, user fields partial
    const updateSchema = z.object({
      _id: zx.id(name),
      _creationTime: z.number().optional(),
      ...partialShape
    })

    // Create schema namespace
    const schema = {
      doc: zDoc,
      docArray,
      base: baseSchema,
      insert: baseSchema, // alias for base
      update: updateSchema
    }

    // Attach everything for comprehensive usage
    // zDoc and docArray are deprecated but kept for backwards compatibility
    // TypeScript @deprecated annotations provide compile-time warnings
    return Object.assign(table, {
      shape,
      schema,
      zDoc,
      docArray
    })
  } else {
    // Union or other schema type logic
    const schema = schemaOrShape as z.ZodTypeAny

    // Convert schema to Convex validator
    const convexValidator = zodToConvex(schema)

    // For unions, use defineTable directly (not Table helper which expects object fields)
    // Convex supports union validators in tables, but TypeScript can't verify the types
    const table = defineTable(asTableValidator(convexValidator))

    // Create document schema with system fields
    const docSchema = addSystemFields(name, schema)

    // Create docArray helper
    const docArray = z.array(docSchema)

    // Create update schema: _id required, _creationTime optional, user fields partial
    let updateSchema: z.ZodTypeAny
    if (isZodUnion(schema)) {
      const originalOptions = getUnionOptions(schema)
      const updateOptions = originalOptions.map((variant: z.ZodTypeAny) => {
        if (variant instanceof z.ZodObject) {
          // Create partial shape for user fields
          const partialShape: Record<string, z.ZodTypeAny> = {}
          for (const [key, value] of Object.entries(variant.shape)) {
            partialShape[key] = (value as z.ZodTypeAny).optional()
          }
          // Add system fields: _id required, _creationTime optional
          return z.object({
            _id: zx.id(name),
            _creationTime: z.number().optional(),
            ...partialShape
          })
        }
        return variant
      })
      updateSchema = createUnionFromOptions(updateOptions)
    } else if (schema instanceof z.ZodObject) {
      // Create partial shape for user fields
      const partialShape: Record<string, z.ZodTypeAny> = {}
      for (const [key, value] of Object.entries(schema.shape)) {
        partialShape[key] = (value as z.ZodTypeAny).optional()
      }
      // Add system fields: _id required, _creationTime optional
      updateSchema = z.object({
        _id: zx.id(name),
        _creationTime: z.number().optional(),
        ...partialShape
      })
    } else {
      updateSchema = schema
    }

    // Create schema namespace
    const schemaNamespace = {
      doc: docSchema,
      docArray,
      base: schema,
      insert: schema, // alias for base
      update: updateSchema
    }

    // Attach helpers for union tables
    // Return structure similar to Table() but without fields-based helpers
    return {
      table,
      tableName: name,
      validator: convexValidator,
      schema: schemaNamespace,
      docArray, // deprecated
      withSystemFields: () => addSystemFields(name, schema)
    }
  }
}
