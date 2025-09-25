import { Table } from 'convex-helpers/server'
import { z } from 'zod'
import {
  zodToConvexFields,
  zodToConvex,
  getObjectShape,
  type ConvexValidatorFromZod,
  type ConvexValidatorFromZodFieldsAuto,
  type ZodValidator
} from './mapping'
import { paginationOptsValidator } from 'convex/server'
import type {
  GenericDataModel,
  QueryBuilder,
  MutationBuilder,
  GenericQueryCtx,
  GenericMutationCtx
} from 'convex/server'
import { zMutation, zQuery } from './wrappers'
import { zid } from './ids'
import type { Validator } from 'convex/values'

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

// Type for the extended document schema
type DocSchema<TableName extends string, Schema extends z.ZodObject<any>> =
  ReturnType<Schema['extend']> extends z.ZodObject<infer Shape>
  ? z.ZodObject<
    Shape & {
      _id: ReturnType<typeof zid<TableName>>
      _creationTime: z.ZodNumber
    }
  >
  : never

// Type for the return value of zodTable
type ZodTableReturn<
  TableName extends string,
  Shape extends Record<string, z.ZodTypeAny>
> = ReturnType<
  typeof Table<ConvexValidatorFromZodFieldsAuto<Shape>, TableName>
> & {
  shape: Shape
  zDoc: z.ZodObject<
    Shape & {
      _id: ReturnType<typeof zid<TableName>>
      _creationTime: z.ZodNumber
    }
  >
}

// Table definition - only accepts raw shapes for better type inference
// Returns both the Table and the shape for use with zCrud
export function zodTable<
  TableName extends string,
  Shape extends Record<string, z.ZodTypeAny>
>(name: TableName, shape: Shape): ZodTableReturn<TableName, Shape> {
  // Convert fields with proper types
  const convexFields = zodToConvexFields(shape)

  // Create the Table from convex-helpers with explicit type
  const table = Table(name, convexFields)

  // Attach the shape for zCrud usage
  return Object.assign(table, {
    shape,
    zDoc: zodDoc(name, z.object(shape))
  }) as ZodTableReturn<TableName, Shape>
}

// Keep the old implementation available for backward compatibility
export function zodTableWithDocs<
  T extends z.ZodObject<any>,
  TableName extends string
>(name: TableName, schema: T) {
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

export function zCrud<
  TableName extends string,
  Shape extends z.ZodRawShape,
  TableWithShape extends { name: TableName; shape: Shape },
  QueryBuilder extends (fn: any) => any,
  MutationBuilder extends (fn: any) => any
>(
  table: TableWithShape,
  queryBuilder: QueryBuilder,
  mutationBuilder: MutationBuilder
) {
  const tableName: TableName = table.name
  const shape = table.shape as Record<string, any>

  return {
    create: zMutation(mutationBuilder as any, shape, async (ctx, args) => {
      return await (ctx as any).db.insert(tableName, args)
    }),

    read: zQuery(
      queryBuilder as any,
      { id: zid(tableName) },
      async (ctx, { id }) => {
        return await (ctx as any).db.get(id)
      }
    ),

    paginate: (queryBuilder as any)({
      args: { paginationOpts: paginationOptsValidator },
      handler: async (ctx: any, { paginationOpts }: any) => {
        return await ctx.db.query(tableName).paginate(paginationOpts)
      }
    }),

    update: zMutation(
      mutationBuilder as any,
      {
        id: zid(tableName),
        patch: z.object(shape as any).partial()
      },
      async (ctx, { id, patch }) => {
        await (ctx as any).db.patch(id, patch)
      }
    ),

    destroy: zMutation(
      mutationBuilder as any,
      { id: zid(tableName) },
      async (ctx, { id }) => {
        const doc = await (ctx as any).db.get(id)
        if (doc) await (ctx as any).db.delete(id)
        return doc
      }
    )
  }
}
