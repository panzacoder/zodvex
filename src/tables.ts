import { Table } from "convex-helpers/server";
import { z } from "zod";
import { zodToConvexFields, getObjectShape, analyzeZod } from "./mapping";
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
  function toConvexZod(s: any): any {
    const meta = analyzeZod(s)
    let base = meta.base
    let out: any

    // Use instanceof checks instead of internal type checking
    if (base instanceof z.ZodString) {
      out = z.string()
    } else if (base instanceof z.ZodNumber) {
      out = z.number()
    } else if (base instanceof z.ZodBigInt) {
      out = z.bigint()
    } else if (base instanceof z.ZodBoolean) {
      out = z.boolean()
    } else if (base instanceof z.ZodDate) {
      // Stored as timestamp in Convex
      out = z.number()
    } else if (base instanceof z.ZodNull) {
      out = z.null()
    } else if (base instanceof z.ZodLiteral) {
      out = z.literal(base.value)
    } else if (base instanceof z.ZodEnum) {
      // Check if it's a native enum (has .enum property) or regular enum (has .options)
      const values = 'enum' in base ? Object.values((base as any).enum) : (base as any).options || []
      out = values.length ? z.union(values.map((v: any) => z.literal(v as any)) as any) : z.never()
    } else if (base instanceof z.ZodUnion) {
      const opts = base.options as any[]
      out = z.union(opts.map((o: any) => toConvexZod(o)) as [any, any, ...any[]])
    } else if (base instanceof z.ZodArray) {
      out = z.array(toConvexZod(base.element))
    } else if (base instanceof z.ZodObject) {
      const shape = getObjectShape(base)
      const mapped: Record<string, any> = {}
      for (const [k, v] of Object.entries(shape)) {
        mapped[k] = toConvexZod(v)
      }
      out = z.object(mapped)
    } else if (base instanceof z.ZodRecord) {
      out = z.record(z.string(), toConvexZod(base.valueType))
    } else if (base instanceof z.ZodTuple) {
      const items = (base as any).items || []
      const member = items.length ? z.union(items.map((i: any) => toConvexZod(i)) as any) : z.any()
      out = z.array(member)
    } else if (base instanceof z.ZodIntersection) {
      const left = base._def.left
      const right = base._def.right
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
        out = z.object(fields)
      } else {
        out = z.any()
      }
    } else {
      out = z.any()
    }

    if (meta.nullable) out = out.nullable()
    if (meta.optional) out = out.optional()
    return out
  }

  const shape = getObjectShape(schema)
  const mapped: Record<string, any> = {}
  for (const [k, v] of Object.entries(shape)) {
    mapped[k] = toConvexZod(v)
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