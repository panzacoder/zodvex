import type { GenericId } from 'convex/values'
import { Table } from 'convex-helpers/server'
import { z } from 'zod'
import { zid } from './ids'
import { type ConvexValidatorFromZodFieldsAuto, getObjectShape, zodToConvexFields } from './mapping'

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

// Table definition - only accepts raw shapes for better type inference
// Returns both the Table and the shape for use with zCrud
export function zodTable<TableName extends string, Shape extends Record<string, z.ZodTypeAny>>(
  name: TableName,
  shape: Shape
) {
  // Convert fields with proper types
  const convexFields = zodToConvexFields(shape) as ConvexValidatorFromZodFieldsAuto<Shape>

  // Create the Table from convex-helpers with explicit type
  const table = Table<ConvexValidatorFromZodFieldsAuto<Shape>, TableName>(name, convexFields)

  // Attach the shape for zCrud usage
  return Object.assign(table, {
    shape,
    zDoc: zodDoc(name, z.object(shape))
  }) as typeof table & {
    shape: Shape
    zDoc: z.ZodObject<
      Shape & {
        _id: ReturnType<typeof zid<TableName>>
        _creationTime: z.ZodNumber
      }
    >
  }
}

// Keep the old implementation available for backward compatibility
export function zodTableWithDocs<T extends z.ZodObject<any>, TableName extends string>(
  name: TableName,
  schema: T
) {
  // Use zodToConvexFields with proper types - pass the shape for type preservation
  const convexFields = zodToConvexFields(schema.shape)

  // Simplified: only convert dates at top level to avoid deep recursion
  const shape = getObjectShape(schema)
  const mapped: Record<string, any> = {}

  for (const [k, field] of Object.entries(shape)) {
    const f = field as z.ZodTypeAny
    // Only handle simple Date fields at top level
    if (f instanceof z.ZodDate) {
      mapped[k] = z.number()
    } else if (f instanceof z.ZodOptional && f.unwrap() instanceof z.ZodDate) {
      mapped[k] = z.number().optional()
    } else if (f instanceof z.ZodNullable && f.unwrap() instanceof z.ZodDate) {
      mapped[k] = z.number().nullable()
    } else if (f instanceof z.ZodDefault) {
      const inner = f.removeDefault()
      if (inner instanceof z.ZodDate) {
        mapped[k] = z.number().optional()
      } else {
        mapped[k] = f // Keep original for non-date defaults
      }
    } else {
      // For all other types, use the original schema
      mapped[k] = f
    }
  }
  const docSchema = z.object({
    ...mapped,
    _id: zid(name),
    _creationTime: z.number()
  })
  const docArray = z.array(docSchema)

  const base = Table(name, convexFields)
  // Return with docSchema and docArray for backward compatibility
  return { ...base, schema, docSchema, docArray }
}
