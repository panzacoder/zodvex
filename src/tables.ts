import { z } from 'zod'
import { Table } from 'convex-helpers/server'
import { zid } from 'convex-helpers/server/zodV4'
import { convexCodec } from './codec'
import { zMutation, zQuery } from './wrappers'
import { paginationOptsValidator } from 'convex/server'

export function zodTable<T extends z.ZodObject<any>, TableName extends string>(name: TableName, schema: T) {
  const codec = convexCodec(schema)
  const tableDefinition = Table(name, codec.toConvexSchema())
  return { ...tableDefinition, codec, schema }
}

export function zCrud<
  TableDefinition extends ReturnType<typeof zodTable>,
  QueryBuilder extends (fn: any) => any,
  MutationBuilder extends (fn: any) => any
>(table: TableDefinition, queryBuilder: QueryBuilder, mutationBuilder: MutationBuilder) {
  const tableName = table.name
  const shape = table.schema.shape as Record<string, z.ZodTypeAny>

  return {
    create: zMutation(mutationBuilder, shape, async (ctx: any, args) => {
      return await ctx.db.insert(tableName, args)
    }),

    read: zQuery(queryBuilder, { id: zid(tableName) }, async (ctx: any, { id }) => {
      return await ctx.db.get(id)
    }),

    paginate: queryBuilder({
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
      async (ctx: any, { id, patch }) => {
        await ctx.db.patch(id, patch)
      }
    ),

    destroy: zMutation(mutationBuilder, { id: zid(tableName) }, async (ctx: any, { id }) => {
      const doc = await ctx.db.get(id)
      if (doc) await ctx.db.delete(id)
      return doc
    })
  }
}

