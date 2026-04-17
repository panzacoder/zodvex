import { mutation, query } from '../../_convex-stubs'

// Parameter destructuring: `({ db }, args) => ...`
export const createViaParamDestructure = mutation({
  handler: async ({ db }, args: { title: string }) => {
    return await db.insert('tasks', { title: args.title })
  }
})

// Body-level destructuring: `const { db } = ctx`
export const createViaBodyDestructure = mutation({
  handler: async (ctx, args: { title: string }) => {
    const { db } = ctx
    return await db.insert('tasks', { title: args.title })
  }
})

// Alias assignment: `const database = ctx.db`
export const createViaAlias = mutation({
  handler: async (ctx, args: { title: string }) => {
    const database = ctx.db
    return await database.insert('tasks', { title: args.title })
  }
})

// Rename in destructure: `const { db: dbRef } = ctx`
export const createViaRenamedDestructure = mutation({
  handler: async (ctx, args: { title: string }) => {
    const { db: dbRef } = ctx
    return await dbRef.insert('tasks', { title: args.title })
  }
})
