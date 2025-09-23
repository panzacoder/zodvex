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

  // Build a Zod schema that matches Convex-stored docs (e.g., Date -> number)
  // Helper to convert Zod's internal types to ZodTypeAny
  function asZodType<T>(schema: T): z.ZodTypeAny {
    return schema as unknown as z.ZodTypeAny
  }

  function toConvexZod(s: z.ZodTypeAny): any {
    // Handle modifiers first
    if (s instanceof z.ZodOptional) {
      const inner = s.unwrap()
      return toConvexZod(asZodType(inner)).optional()
    }

    if (s instanceof z.ZodNullable) {
      const inner = s.unwrap()
      return toConvexZod(asZodType(inner)).nullable()
    }

    if (s instanceof z.ZodDefault) {
      const inner = s.removeDefault()
      return toConvexZod(asZodType(inner)).optional()
    }

    // Handle base types
    if (s instanceof z.ZodString) {
      return z.string()
    } else if (s instanceof z.ZodNumber) {
      return z.number()
    } else if (s instanceof z.ZodBigInt) {
      return z.bigint()
    } else if (s instanceof z.ZodBoolean) {
      return z.boolean()
    } else if (s instanceof z.ZodDate) {
      // Stored as timestamp in Convex
      return z.number()
    } else if (s instanceof z.ZodNull) {
      return z.null()
    } else if (s instanceof z.ZodLiteral) {
      // Handle undefined literal
      const value = s.value
      if (value === undefined) {
        return z.any()
      }
      return z.literal(value)
    } else if (s instanceof z.ZodEnum) {
      // Use public .options property
      const values = s.options || []
      return values.length ? z.union(values.map((v: any) => z.literal(v)) as any) : z.never()
    } else if (s instanceof z.ZodUnion) {
      const opts = s.options as any[]
      return z.union(opts.map((o: any) => toConvexZod(o)) as [any, any, ...any[]])
    } else if (s instanceof z.ZodArray) {
      return z.array(toConvexZod(asZodType(s.element)))
    } else if (s instanceof z.ZodObject) {
      const shape = getObjectShape(s)
      const mapped: Record<string, any> = {}
      for (const [k, v] of Object.entries(shape)) {
        mapped[k] = toConvexZod(v as z.ZodTypeAny)
      }
      return z.object(mapped)
    } else if (s instanceof z.ZodRecord) {
      return z.record(z.string(), toConvexZod(asZodType(s.valueType)))
    } else if (s instanceof z.ZodTuple) {
      // Cannot access items without _def, map to generic array
      return z.array(z.any())
    } else if (s instanceof z.ZodIntersection) {
      // Cannot access left/right schemas without _def, map to any
      return z.any()
    } else {
      return z.any()
    }
  }

  const shape = getObjectShape(schema)
  const mapped: Record<string, any> = {}
  for (const [k, v] of Object.entries(shape)) {
    mapped[k] = toConvexZod(v as z.ZodTypeAny)
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
