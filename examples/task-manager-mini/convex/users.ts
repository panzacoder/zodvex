import { z } from "zod/mini";
import { zx } from "zodvex/core";
import { zq, zm } from "./functions";
import { UserModel } from "./models/user";
import { tagged } from "./tagged";

export const get = zq({
  args: { id: zx.id("users") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
  returns: UserModel.schema.doc.nullable(),
});

export const getByEmail = zq({
  args: { email: tagged(z.string()) }, // inline factory codec — NOT the same instance as model
  handler: async (ctx, { email }) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email.value", email.value))
      .unique();
  },
  returns: UserModel.schema.doc.nullable(),
});

export const create = zm({
  args: {
    name: z.string(),
    email: z.string(),
    avatarUrl: z.optional(z.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("users", {
      ...args,
      createdAt: new Date(),
    });
    return id;
  },
  returns: zx.id("users"),
});

export const update = zm({
  args: UserModel.schema.update,
  handler: async (ctx, { _id, ...fields }) => {
    await ctx.db.patch(_id, fields);
  },
});
