import { defineTable } from 'convex/server'
import type { GenericId } from 'convex/values'
import { Table } from 'convex-helpers/server'
import { z } from 'zod'
import { zid } from './ids'
import { type ConvexValidatorFromZodFieldsAuto, zodToConvex, zodToConvexFields } from './mapping'

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
export function addSystemFields<T extends string, S extends z.ZodTypeAny>(
  tableName: T,
  schema: S
): z.ZodTypeAny {
  // Handle union schemas - add system fields to each variant
  if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion) {
    const options = (schema as z.ZodUnion<any>).options.map((variant: z.ZodTypeAny) => {
      if (variant instanceof z.ZodObject) {
        return variant.extend({
          _id: zid(tableName),
          _creationTime: z.number()
        })
      }
      // Non-object variants are returned as-is (shouldn't happen in practice)
      return variant
    })
    return z.union(options as any)
  }

  // Handle object schemas
  if (schema instanceof z.ZodObject) {
    return schema.extend({
      _id: zid(tableName),
      _creationTime: z.number()
    })
  }

  // Fallback: return schema as-is
  return schema
}

// Helper to create a Zod schema for a Convex document
export function zodDoc<
  TableName extends string,
  Shape extends z.ZodRawShape,
  Schema extends z.ZodObject<Shape>
>(
  tableName: TableName,
  schema: Schema
): z.ZodObject<
  Shape & {
    _id: ReturnType<typeof zid<TableName>>
    _creationTime: z.ZodNumber
  }
> {
  // Use extend to preserve the original schema's type information
  return schema.extend({
    _id: zid(tableName),
    _creationTime: z.number()
  }) as any
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
export function zodTable<TableName extends string, Shape extends Record<string, z.ZodTypeAny>>(
  name: TableName,
  shape: Shape
): ReturnType<typeof Table<any, TableName>> & {
  shape: Shape
  zDoc: z.ZodObject<
    Shape & {
      _id: ReturnType<typeof zid<TableName>>
      _creationTime: z.ZodNumber
    }
  >
  docArray: z.ZodArray<
    z.ZodObject<
      Shape & {
        _id: ReturnType<typeof zid<TableName>>
        _creationTime: z.ZodNumber
      }
    >
  >
}

export function zodTable<TableName extends string, Schema extends z.ZodTypeAny>(
  name: TableName,
  schema: Schema
): {
  table: ReturnType<typeof defineTable>
  tableName: TableName
  validator: ReturnType<typeof zodToConvex<Schema>>
  schema: Schema
  docArray: z.ZodArray<ReturnType<typeof addSystemFields<TableName, Schema>>>
  withSystemFields: () => ReturnType<typeof addSystemFields<TableName, Schema>>
}

export function zodTable<
  TableName extends string,
  SchemaOrShape extends z.ZodTypeAny | Record<string, z.ZodTypeAny>
>(name: TableName, schemaOrShape: SchemaOrShape): any {
  // Detect if it's an object shape or a schema
  if (isObjectShape(schemaOrShape)) {
    // Original object shape logic
    const shape = schemaOrShape as Record<string, z.ZodTypeAny>

    // Convert fields with proper types
    const convexFields = zodToConvexFields(shape) as ConvexValidatorFromZodFieldsAuto<typeof shape>

    // Create the Table from convex-helpers with explicit type
    const table = Table<ConvexValidatorFromZodFieldsAuto<typeof shape>, TableName>(
      name,
      convexFields
    )

    // Create zDoc schema with system fields
    const zDoc = zodDoc(name, z.object(shape))

    // Create docArray helper for return types
    const docArray = z.array(zDoc)

    // Attach everything for comprehensive usage
    return Object.assign(table, {
      shape,
      zDoc,
      docArray
    })
  } else {
    // Union or other schema type logic
    const schema = schemaOrShape as z.ZodTypeAny

    // Convert schema to Convex validator
    const convexValidator = zodToConvex(schema)

    // For unions, use defineTable directly (not Table helper which expects object fields)
    // Note: TypeScript types don't reflect it, but Convex supports union validators in tables
    const table = defineTable(convexValidator as any)

    // Create document schema with system fields
    const withFields = addSystemFields(name, schema)

    // Create docArray helper
    const docArray = z.array(withFields)

    // Attach helpers for union tables
    // Return structure similar to Table() but without fields-based helpers
    return {
      table,
      tableName: name,
      validator: convexValidator,
      schema,
      docArray,
      withSystemFields: () => addSystemFields(name, schema)
    }
  }
}
