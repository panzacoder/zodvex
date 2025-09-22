import { Table } from "convex-helpers/server";
import { z } from "zod";
import * as z4 from "zod/v4/core";
import { zodToConvexFields, getObjectShape, analyzeZod } from "./mapping";
import { paginationOptsValidator } from "convex/server";
import { zMutation, zQuery } from "./wrappers";
import { zid } from "./ids";
import { getDef, isZ4Schema, isObjectSchema } from "./z4";
import { convexCodec } from "./codec";

export function zodTable<T extends z4.$ZodObject, TableName extends string>(
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
    if (!isZ4Schema(base)) out = z.any()
    else {
      const def = getDef(base)
      switch (def.type) {
        case 'string':
          out = z.string();
          break
        case 'number':
          out = z.number();
          break
        case 'bigint':
          out = z.bigint();
          break
        case 'boolean':
          out = z.boolean();
          break
        case 'date':
          // Stored as timestamp in Convex
          out = z.number();
          break
        case 'null':
          out = z.null();
          break
        case 'literal': {
          const values: any[] = def.values ?? []
          out = values.length ? z.union(values.map((v) => z.literal(v)) as any) : z.never()
          break
        }
        case 'enum': {
          const valuesSet: Set<any> | undefined = (base as any)._zod?.values
          const values: any[] = valuesSet ? Array.from(valuesSet) : (def.entries ? (def.entries as any[]) : [])
          out = values.length ? z.union(values.map((v) => z.literal(v)) as any) : z.never()
          break
        }
        case 'union': {
          const opts: any[] = def.options as any[]
          out = z.union(opts.map((o) => toConvexZod(o)) as [any, any, ...any[]])
          break
        }
        case 'array': {
          out = z.array(toConvexZod(def.element))
          break
        }
        case 'object': {
          const shape = getObjectShape(base)
          const mapped: Record<string, any> = {}
          for (const [k, v] of Object.entries(shape)) mapped[k] = toConvexZod(v)
          out = z.object(mapped)
          break
        }
        case 'record': {
          out = z.record(z.string(), toConvexZod(def.valueType))
          break
        }
        case 'tuple': {
          const items: any[] = def.items ?? []
          const member = items.length ? z.union(items.map((i) => toConvexZod(i)) as any) : z.any()
          out = z.array(member)
          break
        }
        case 'intersection': {
          const left = def.left
          const right = def.right
          if (isObjectSchema(left) && isObjectSchema(right)) {
            const l = getObjectShape(left)
            const r = getObjectShape(right)
            const keys = new Set([...Object.keys(l), ...Object.keys(r)])
            const fields: Record<string, any> = {}
            for (const k of keys) {
              const lz = l[k]
              const rz = r[k]
              if (lz && rz) fields[k] = z.union([toConvexZod(lz), toConvexZod(rz)] as any)
              else fields[k] = toConvexZod((lz || rz) as any)
            }
            out = z.object(fields)
          } else out = z.any()
          break
        }
        default:
          out = z.any()
      }
    }
    if (meta.nullable) out = out.nullable()
    if (meta.optional) out = out.optional()
    return out
  }

  const shape = getObjectShape(schema)
  const mapped: Record<string, any> = {}
  for (const [k, v] of Object.entries(shape)) mapped[k] = toConvexZod(v)
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
