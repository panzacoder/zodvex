import { paginationOptsValidator } from "convex/server";
import { Table } from "convex-helpers/server";
import { z } from "zod";
import { convexCodec } from "./codec";
import { zMutation, zQuery } from "./wrappers";
import { zid } from "./ids";

export function zodTable<T extends z.ZodObject<any>, TableName extends string>(
  name: TableName,
  schema: T,
) {
  const codec = convexCodec(schema);
  const tableDefinition = Table(name, codec.toConvexSchema());
  // Ensure the returned shape carries the literal table name type parameter
  return { ...tableDefinition, name, codec, schema } as {
    name: TableName;
    table: any;
    doc: any;
    withoutSystemFields: any;
    withSystemFields: any;
    systemFields: any;
    _id: any;
    codec: ReturnType<typeof convexCodec<T>>;
    schema: T;
  };
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
  const shape = table.schema.shape as Record<string, z.ZodTypeAny>;

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
        patch: z.object(shape).partial(),
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
