import { Table } from "convex-helpers/server";
import { z } from "zod";
import { zodToConvexFields, getObjectShape, zodToConvex } from "./mapping";
import { paginationOptsValidator } from "convex/server";
import { zMutation, zQuery } from "./wrappers";
import { zid } from "./ids";
import { convexCodec } from "./codec";

export function zodTable<T extends z.ZodObject<any>, TableName extends string>(
  name: TableName,
  schema: T,
) {
  // Directly use zodToConvexFields to avoid codec complexity
  const convexFields = zodToConvexFields(schema);

  // Build a Zod schema that matches Convex-stored docs (e.g., Date -> number)
  function toConvexZod(s: z.ZodTypeAny): any {
    // Handle modifiers first
    if (s instanceof z.ZodOptional) {
      const inner = s.unwrap()
      return toConvexZod(inner).optional()
    }

    if (s instanceof z.ZodNullable) {
      const inner = s.unwrap()
      return toConvexZod(inner).nullable()
    }

    if (s instanceof z.ZodDefault) {
      const inner = s.removeDefault()
      return toConvexZod(inner).optional()
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
      return z.literal((s as any).value)
    } else if (s instanceof z.ZodEnum) {
      // Check if it's a native enum (has .enum property) or regular enum (has .options)
      const values = 'enum' in s ? Object.values((s as any).enum) : (s as any).options || []
      return values.length ? z.union(values.map((v: any) => z.literal(v as any)) as any) : z.never()
    } else if (s instanceof z.ZodUnion) {
      const opts = s.options as any[]
      return z.union(opts.map((o: any) => toConvexZod(o)) as [any, any, ...any[]])
    } else if (s instanceof z.ZodArray) {
      return z.array(toConvexZod(s.element))
    } else if (s instanceof z.ZodObject) {
      const shape = getObjectShape(s)
      const mapped: Record<string, any> = {}
      for (const [k, v] of Object.entries(shape)) {
        mapped[k] = toConvexZod(v as z.ZodTypeAny)
      }
      return z.object(mapped)
    } else if (s instanceof z.ZodRecord) {
      return z.record(z.string(), toConvexZod(s.valueType))
    } else if (s instanceof z.ZodTuple) {
      const items = (s as any).items || []
      const member = items.length ? z.union(items.map((i: any) => toConvexZod(i)) as any) : z.any()
      return z.array(member)
    } else if (s instanceof z.ZodIntersection) {
      const left = (s as any)._def.left
      const right = (s as any)._def.right
      if (left instanceof z.ZodObject && right instanceof z.ZodObject) {
        const l = getObjectShape(left)
        const r = getObjectShape(right)
        const keys = new Set([...Object.keys(l), ...Object.keys(r)])
        const fields: Record<string, any> = {}
        for (const k of keys) {
          const lz = l[k]
          const rz = r[k]
          if (lz && rz) {
            fields[k] = z.union([toConvexZod(lz), toConvexZod(rz)] as any)
          } else {
            fields[k] = toConvexZod((lz || rz) as any)
          }
        }
        return z.object(fields)
      } else {
        return z.any()
      }
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
  return { ...base, schema, codec: convexCodec(schema as any), docSchema, docArray } as any
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