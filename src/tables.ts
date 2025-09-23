import { Table } from "convex-helpers/server";
import { z } from "zod";
import { zodToConvexFields, getObjectShape, type ConvexValidatorFromZod } from "./mapping";
import { paginationOptsValidator } from "convex/server";
import type { GenericDataModel, QueryBuilder, MutationBuilder, GenericQueryCtx, GenericMutationCtx } from "convex/server";
import { zMutation, zQuery } from "./wrappers";
import { zid } from "./ids";
import type { Validator } from "convex/values";

// Helper to create a Zod schema for a Convex document
export function zodDoc<
  TableName extends string,
  Shape extends z.ZodRawShape,
  Schema extends z.ZodObject<Shape>
>(
  tableName: TableName,
  schema: Schema
): z.ZodObject<Shape & {
  _id: ReturnType<typeof zid<TableName>>;
  _creationTime: z.ZodNumber;
}> {
  // Use extend to preserve the original schema's type information
  return schema.extend({
    _id: zid(tableName),
    _creationTime: z.number()
  }) as any;
}

// Helper to create nullable doc schema
export function zodDocOrNull<
  TableName extends string,
  Shape extends z.ZodRawShape,
  Schema extends z.ZodObject<Shape>
>(
  tableName: TableName,
  schema: Schema
) {
  return z.union([zodDoc(tableName, schema), z.null()]);
}

// Type for the extended document schema
type DocSchema<TableName extends string, Schema extends z.ZodObject<any>> = ReturnType<Schema['extend']> extends z.ZodObject<infer Shape>
  ? z.ZodObject<Shape & {
      _id: ReturnType<typeof zid<TableName>>;
      _creationTime: z.ZodNumber;
    }>
  : never;

// Simplified table definition that preserves types from convex-helpers
export function zodTable<
  TableName extends string,
  Shape extends z.ZodRawShape,
  Schema extends z.ZodObject<Shape>
>(
  name: TableName,
  schema: Schema,
) {
  // Convert fields with proper types - use shape directly for type preservation
  const convexFields = zodToConvexFields(schema.shape);

  // Create the base table definition from convex-helpers
  // The type is now properly inferred from zodToConvexFields
  const base = Table(name, convexFields);

  // Pre-create the doc schemas to ensure consistent types
  const docSchema = zodDoc(name, schema);
  const docOrNullSchema = zodDocOrNull(name, schema);

  // Augment with a reference to the original Zod schema and doc helpers
  return {
    ...base,
    schema,
    doc: () => docSchema,
    docOrNull: () => docOrNullSchema
  };
}

// Keep the old implementation available for backward compatibility
export function zodTableWithDocs<T extends z.ZodObject<any>, TableName extends string>(
  name: TableName,
  schema: T,
) {
  // Use zodToConvexFields with proper types - use shape directly for type preservation
  const convexFields = zodToConvexFields(schema.shape);

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
  const docSchema = z.object({ ...mapped, _id: zid(name), _creationTime: z.number() })
  const docArray = z.array(docSchema)

  const base = Table(name, convexFields)
  // Return with docSchema and docArray for backward compatibility
  return { ...base, schema, docSchema, docArray }
}

export function zCrud<
  TableName extends string,
  TSchema extends z.ZodObject<any>,
  TableDefinition extends { name: TableName; schema: TSchema },
  QueryBuilder extends (fn: any) => any,
  MutationBuilder extends (fn: any) => any,
>(
  table: TableDefinition,
  queryBuilder: QueryBuilder,
  mutationBuilder: MutationBuilder,
) {
  const tableName: TableName = table.name;
  const shape = getObjectShape(table.schema as any) as Record<string, any>;

  return {
    create: zMutation(mutationBuilder as any, shape, async (ctx, args) => {
      return await (ctx as any).db.insert(tableName, args);
    }),

    read: zQuery(
      queryBuilder as any,
      { id: zid(tableName) },
      async (ctx, { id }) => {
        return await (ctx as any).db.get(id);
      },
    ),

    paginate: (queryBuilder as any)({
      args: { paginationOpts: paginationOptsValidator },
      handler: async (ctx: any, { paginationOpts }: any) => {
        return await ctx.db.query(tableName).paginate(paginationOpts);
      },
    }),

    update: zMutation(
      mutationBuilder as any,
      {
        id: zid(tableName),
        patch: z.object(shape as any).partial(),
      },
      async (ctx, { id, patch }) => {
        await (ctx as any).db.patch(id, patch);
      },
    ),

    destroy: zMutation(
      mutationBuilder as any,
      { id: zid(tableName) },
      async (ctx, { id }) => {
        const doc = await (ctx as any).db.get(id);
        if (doc) await (ctx as any).db.delete(id);
        return doc;
      },
    ),
  };
}
