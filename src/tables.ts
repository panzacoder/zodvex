import type {
  MutationBuilder as ConvexMutationBuilder,
  QueryBuilder as ConvexQueryBuilder,
  FunctionVisibility,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
  PaginationResult,
  RegisteredMutation,
  RegisteredQuery,
  WithoutSystemFields
} from 'convex/server'
import { paginationOptsValidator } from 'convex/server'
import type { GenericId, Infer, Validator } from 'convex/values'
import type { CustomBuilder } from 'convex-helpers/server/customFunctions'
import { Table } from 'convex-helpers/server'
import { z } from 'zod'
import { zid } from './ids'
import {
  type ConvexValidatorFromZod,
  type ConvexValidatorFromZodFieldsAuto,
  getObjectShape,
  type ZodValidator,
  zodToConvex,
  zodToConvexFields
} from './mapping'
import { zMutation, zQuery } from './wrappers'

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

// Type to extract the input shape from a Zod schema
type InferInputType<Shape extends Record<string, z.ZodTypeAny>> = z.infer<
  z.ZodObject<Shape>
>

// Type to extract the document shape (with system fields)
type InferDocType<
  TableName extends string,
  Shape extends Record<string, z.ZodTypeAny>
> = InferInputType<Shape> & {
  _id: GenericId<TableName>
  _creationTime: number
}

// Helper to extract visibility from builders (including CustomBuilder)
type ExtractQueryVisibility<B> = B extends (
  fn: any
) => RegisteredQuery<infer V, any, any>
  ? V
  : B extends CustomBuilder<'query', any, any, any, any, infer V, any>
    ? V
    : 'public'
type ExtractMutationVisibility<B> = B extends (
  fn: any
) => RegisteredMutation<infer V, any, any>
  ? V
  : B extends CustomBuilder<'mutation', any, any, any, any, infer V, any>
    ? V
    : 'public'

// Type-safe CRUD operations for a zodTable
export function zCrud<
  TableName extends string,
  Shape extends Record<string, z.ZodTypeAny>,
  TableWithShape extends {
    name: TableName
    shape: Shape
    zDoc: z.ZodObject<any>
  },
  QueryBuilder extends ConvexQueryBuilder<any, any> | CustomBuilder<'query', any, any, any, any, any, any>,
  MutationBuilder extends ConvexMutationBuilder<any, any> | CustomBuilder<'mutation', any, any, any, any, any, any>,
  QueryVisibility extends
    FunctionVisibility = ExtractQueryVisibility<QueryBuilder>,
  MutationVisibility extends
    FunctionVisibility = ExtractMutationVisibility<MutationBuilder>
>(
  table: TableWithShape,
  queryBuilder: QueryBuilder,
  mutationBuilder: MutationBuilder
): {
  create: RegisteredMutation<
    MutationVisibility,
    InferInputType<Shape>,
    Promise<InferDocType<TableName, Shape>>
  >
  read: RegisteredQuery<
    QueryVisibility,
    { id: GenericId<TableName> },
    Promise<InferDocType<TableName, Shape> | null>
  >
  paginate: RegisteredQuery<
    QueryVisibility,
    { paginationOpts: Infer<typeof paginationOptsValidator> },
    Promise<PaginationResult<any>>
  >
  update: RegisteredMutation<
    MutationVisibility,
    {
      id: GenericId<TableName>
      patch: Partial<InferInputType<Shape>>
    },
    Promise<InferDocType<TableName, Shape> | null>
  >
  destroy: RegisteredMutation<
    MutationVisibility,
    { id: GenericId<TableName> },
    Promise<InferDocType<TableName, Shape> | null>
  >
} {
  const tableName = table.name
  const shape = table.shape
  const docShape = table.zDoc

  return {
    create: zMutation(
      mutationBuilder,
      shape,
      async (ctx: any, args: any) => {
        const id = await ctx.db.insert(tableName, args)
        return await ctx.db.get(id)
      },
      { returns: docShape }
    ),

    read: zQuery(
      queryBuilder,
      { id: zid(tableName) },
      async (ctx: any, { id }) => {
        return await ctx.db.get(id)
      },
      { returns: docShape.nullable() }
    ),

    paginate: (queryBuilder as any)({
      args: { paginationOpts: paginationOptsValidator },
      handler: async (ctx: any, { paginationOpts }: any) => {
        return await ctx.db.query(tableName).paginate(paginationOpts)
      }
    }),

    update: zMutation(
      mutationBuilder,
      {
        id: zid(tableName),
        patch: z.object(shape).partial()
      },
      async (ctx: any, { id, patch }: any) => {
        await ctx.db.patch(id, patch)
        return await ctx.db.get(id)
      },
      { returns: docShape.nullable() }
    ),

    destroy: zMutation(
      mutationBuilder,
      { id: zid(tableName) },
      async (ctx: any, { id }: any) => {
        const doc = await ctx.db.get(id)
        if (doc) await ctx.db.delete(id)
        return doc
      },
      { returns: docShape.nullable() }
    )
  } as unknown as {
    create: RegisteredMutation<
      MutationVisibility,
      InferInputType<Shape>,
      Promise<InferDocType<TableName, Shape>>
    >
    read: RegisteredQuery<
      QueryVisibility,
      { id: GenericId<TableName> },
      Promise<InferDocType<TableName, Shape> | null>
    >
    paginate: RegisteredQuery<
      QueryVisibility,
      { paginationOpts: Infer<typeof paginationOptsValidator> },
      Promise<PaginationResult<any>>
    >
    update: RegisteredMutation<
      MutationVisibility,
      {
        id: GenericId<TableName>
        patch: Partial<InferInputType<Shape>>
      },
      Promise<InferDocType<TableName, Shape> | null>
    >
    destroy: RegisteredMutation<
      MutationVisibility,
      { id: GenericId<TableName> },
      Promise<InferDocType<TableName, Shape> | null>
    >
  }
}
