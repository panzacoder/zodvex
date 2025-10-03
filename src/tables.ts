import type { GenericId } from 'convex/values'
import { Table } from 'convex-helpers/server'
import { z } from 'zod'
import { zid } from './ids'
import { type ConvexValidatorFromZodFieldsAuto, zodToConvexFields } from './mapping'

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
 * Defines a Convex table using a raw Zod shape (an object mapping field names to Zod types).
 *
 * This function intentionally accepts a raw shape instead of a ZodObject instance.
 * Accepting raw shapes allows TypeScript to infer field types more accurately and efficiently,
 * leading to better type inference and performance throughout the codebase.
 * This architectural decision is important for projects that rely heavily on type safety and
 * developer experience, as it avoids the type erasure that can occur when using ZodObject directly.
 *
 * Returns the Table definition along with Zod schemas for documents and arrays.
 *
 * @param name - The table name
 * @param shape - A raw object mapping field names to Zod validators
 * @returns A Table with attached shape, zDoc schema, and docArray helper
 *
 * @example
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
 */
export function zodTable<TableName extends string, Shape extends Record<string, z.ZodTypeAny>>(
  name: TableName,
  shape: Shape
) {
  // Convert fields with proper types
  const convexFields = zodToConvexFields(shape) as ConvexValidatorFromZodFieldsAuto<Shape>

  // Create the Table from convex-helpers with explicit type
  const table = Table<ConvexValidatorFromZodFieldsAuto<Shape>, TableName>(name, convexFields)

  // Create zDoc schema with system fields
  const zDoc = zodDoc(name, z.object(shape))

  // Create docArray helper for return types
  const docArray = z.array(zDoc)

  // Attach everything for comprehensive usage
  return Object.assign(table, {
    shape,
    zDoc,
    docArray
  }) as typeof table & {
    shape: Shape
    zDoc: z.ZodObject<
      Shape & {
        _id: ReturnType<typeof zid<TableName>>
        _creationTime: z.ZodNumber
      }
    >
    docArray: z.ZodArray<typeof zDoc>
  }
}
