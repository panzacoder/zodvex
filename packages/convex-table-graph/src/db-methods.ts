/**
 * The Convex `ctx.db` API surface we statically analyze.
 *
 * - `string` table source means the table name is expected as a string-literal argument
 *   at the given index (e.g. `db.query("tasks")` — index 0).
 * - `idType` table source means the table name is encoded in the `Id<"tableName">` type
 *   of the argument at the given index (e.g. `db.patch(taskId, ...)` — taskId: Id<"tasks">).
 */

export type DbOp = 'read' | 'write'
export type TableSource = 'string' | 'idType'

export type DbMethodSpec = {
  op: DbOp
  tableSource: TableSource
  argIndex: number
}

export const DB_METHODS: Record<string, DbMethodSpec> = {
  query: { op: 'read', tableSource: 'string', argIndex: 0 },
  get: { op: 'read', tableSource: 'idType', argIndex: 0 },
  insert: { op: 'write', tableSource: 'string', argIndex: 0 },
  patch: { op: 'write', tableSource: 'idType', argIndex: 0 },
  replace: { op: 'write', tableSource: 'idType', argIndex: 0 },
  delete: { op: 'write', tableSource: 'idType', argIndex: 0 }
}

/**
 * Methods on `ctx.db` we explicitly choose NOT to track.
 *
 * - `normalizeId(table, id)` validates an Id string but does not actually read data.
 *   Recording it would inflate the `reads` set without reflecting any real data access.
 * - `system.*` access is for Convex-internal tables (files, env vars, etc.).
 */
export const DB_METHODS_IGNORED = new Set(['normalizeId', 'system'])
