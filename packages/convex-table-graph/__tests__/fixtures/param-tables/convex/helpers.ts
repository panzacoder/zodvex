import type { DatabaseWriter, Id } from '../../_convex-stubs'

// Parametric helper — the table name arrives as an argument (hotpot's getX pattern).
export async function getX<T extends string>(db: DatabaseWriter, table: T, id: Id<T>) {
  const doc = await db.get(table, id)
  if (!doc) throw new Error(`not found in ${table}`)
  return doc
}

// Parametric helper touching multiple db methods (hotpot's upsert pattern).
export async function upsert(db: DatabaseWriter, table: string, doc: Record<string, unknown>) {
  const existing = await db
    .query(table)
    .withIndex('key', (q) => q)
    .unique()
  if (existing) {
    await db.patch(table, existing._id, doc)
    return existing._id
  }
  return await db.insert(table, doc)
}

// Two-hop pass-through: the literal must survive an intermediate helper.
export async function ensure<T extends string>(db: DatabaseWriter, table: T, id: Id<T>) {
  return getX(db, table, id)
}
