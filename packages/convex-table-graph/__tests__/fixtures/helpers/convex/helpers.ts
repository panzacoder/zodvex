import type { DatabaseWriter, MutationCtx } from '../../_convex-stubs'

// Helper takes db directly
export async function insertTask(db: DatabaseWriter, title: string): Promise<void> {
  await db.insert('tasks', { title })
}

// Helper takes ctx, extracts db itself
export async function archiveTaskWithAudit(ctx: MutationCtx, taskId: string): Promise<void> {
  const { db } = ctx
  // Archive — reads tasks then writes (via audit log)
  const existing = await db.query('tasks').first()
  if (existing) {
    await db.insert('auditLog', { taskId, action: 'archive' })
  }
}

// Two-hop helper: takes db, passes db to another helper.
export async function bulkInsertTasks(db: DatabaseWriter, titles: string[]): Promise<void> {
  for (const title of titles) {
    await insertTask(db, title)
  }
}

// Untainted helper — does not take db or ctx, should not be followed.
export function formatTitle(title: string): string {
  return title.trim().slice(0, 100)
}
