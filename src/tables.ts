import { Table } from "convex-helpers/server";
import { z } from "zod";
import { zodToConvexFields, getObjectShape } from "./mapping";
import { paginationOptsValidator } from "convex/server";
import { zMutation, zQuery } from "./wrappers";
import { zid } from "./ids";

// Simplified table definition that avoids type recursion
export function zodTable<TableName extends string>(
  name: TableName,
  schema: z.ZodObject<any>,
) {
  // Convert fields once
  const convexFields = zodToConvexFields(schema);

  // Create the base table definition from convex-helpers
  const base = Table(name, convexFields) as any;

  // Augment with a reference to the original Zod schema so downstream
  // helpers (e.g., zCrud) can derive field shapes without heavy types.
  return { ...base, schema } as any;
}

// Keep the old implementation available for backward compatibility
export function zodTableWithDocs<T extends z.ZodObject<any>, TableName extends string>(
  name: TableName,
  schema: T,
) {
  // Directly use zodToConvexFields to avoid codec complexity
  const convexFields = zodToConvexFields(schema);


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

  const base = Table(name, convexFields) as any
  // Return with docSchema and docArray for backward compatibility
  return { ...base, schema, docSchema, docArray } as any
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
    create: zMutation(mutationBuilder, shape, async (ctx: any, args) => {
      return await ctx.db.insert(tableName, args);
    }),

    read: zQuery(
      queryBuilder,
      { id: zid(tableName) },
      async (ctx: any, { id }) => {
        return await ctx.db.get(id);
      },
    ),

    paginate: queryBuilder({
      args: { paginationOpts: paginationOptsValidator },
      handler: async (ctx: any, { paginationOpts }: any) => {
        return await ctx.db.query(tableName).paginate(paginationOpts);
      },
    }),

    update: zMutation(
      mutationBuilder,
      {
        id: zid(tableName),
        patch: z.object(shape as any).partial(),
      },
      async (ctx: any, { id, patch }) => {
        await ctx.db.patch(id, patch);
      },
    ),

    destroy: zMutation(
      mutationBuilder,
      { id: zid(tableName) },
      async (ctx: any, { id }) => {
        const doc = await ctx.db.get(id);
        if (doc) await ctx.db.delete(id);
        return doc;
      },
    ),
  };
}
