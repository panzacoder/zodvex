import type { DatabaseWriter } from '../../_convex-stubs'
import { mutation } from '../../_convex-stubs'

// Chain of helpers to exercise depth-limit behavior.
async function level1(db: DatabaseWriter, title: string): Promise<void> {
  await level2(db, title)
}

async function level2(db: DatabaseWriter, title: string): Promise<void> {
  await level3(db, title)
}

async function level3(db: DatabaseWriter, title: string): Promise<void> {
  await level4(db, title)
}

async function level4(db: DatabaseWriter, title: string): Promise<void> {
  await db.insert('tasks', { title })
}

export const deep = mutation({
  handler: async (ctx, args: { title: string }) => {
    // handler -> level1 -> level2 -> level3 -> level4
    //   depth:     1        2        3        4  (exceeds default max of 3)
    await level1(ctx.db, args.title)
  }
})
