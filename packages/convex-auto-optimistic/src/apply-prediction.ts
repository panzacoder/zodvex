import type { Prediction } from './types'

/**
 * Shape of a Convex paginated query result.
 * See: https://docs.convex.dev/database/pagination
 */
type PaginationResult = {
  page: unknown[]
  isDone: boolean
  continueCursor: string
}

function isPaginationResult(value: unknown): value is PaginationResult {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    Array.isArray(v.page) && typeof v.isDone === 'boolean' && typeof v.continueCursor === 'string'
  )
}

function hasId(value: unknown): value is { _id: string; [k: string]: unknown } {
  return (
    value !== null &&
    typeof value === 'object' &&
    '_id' in value &&
    typeof (value as { _id: unknown })._id === 'string'
  )
}

/**
 * Apply a mutation prediction to a single cached query result.
 *
 * The result shape is inferred at runtime; supported shapes are:
 *   - `Document[]` — standard list-style query
 *   - `Document | null` — `.first()`, `.unique()`, `ctx.db.get()` queries
 *   - `{ page, isDone, continueCursor }` — paginated queries (patch/delete only)
 *
 * Returns the patched result or the input unchanged if the shape is not
 * recognized or the prediction doesn't apply.
 */
export function applyPrediction(result: unknown, prediction: Prediction): unknown {
  // Query not yet loaded — don't invent a value. Convex's subscription will
  // populate it later; any optimistic state here would be misleading.
  if (result === undefined) return undefined

  if (prediction.kind === 'insert') return applyInsert(result, prediction.doc)
  if (prediction.kind === 'patch') return applyPatch(result, prediction.id, prediction.changes)
  if (prediction.kind === 'delete') return applyDelete(result, prediction.id)

  return result
}

function applyInsert(result: unknown, doc: { _id: string; [k: string]: unknown }): unknown {
  if (Array.isArray(result)) {
    // Avoid duplicating: if the doc is already there (by _id), leave it.
    const already = result.some((r) => hasId(r) && r._id === doc._id)
    if (already) return result
    return [...result, doc]
  }

  if (result === null) {
    // A `.first()`/`.unique()`-style query that previously returned null
    // now predictably returns the new doc.
    return doc
  }

  if (isPaginationResult(result)) {
    // Ambiguous: should the new doc land on this page? Without filter/sort
    // semantics we can't know. Err on the side of not mis-ordering.
    return result
  }

  return result
}

function applyPatch(result: unknown, id: string, changes: Record<string, unknown>): unknown {
  if (Array.isArray(result)) {
    let changed = false
    const next = result.map((item) => {
      if (hasId(item) && item._id === id) {
        changed = true
        return { ...item, ...changes }
      }
      return item
    })
    return changed ? next : result
  }

  if (hasId(result) && result._id === id) {
    return { ...result, ...changes }
  }

  if (isPaginationResult(result)) {
    const patchedPage = applyPatch(result.page, id, changes)
    if (patchedPage === result.page) return result
    return { ...result, page: patchedPage }
  }

  return result
}

function applyDelete(result: unknown, id: string): unknown {
  if (Array.isArray(result)) {
    const filtered = result.filter((item) => !(hasId(item) && item._id === id))
    if (filtered.length === result.length) return result
    return filtered
  }

  if (hasId(result) && result._id === id) {
    return null
  }

  if (isPaginationResult(result)) {
    const filteredPage = applyDelete(result.page, id)
    if (filteredPage === result.page) return result
    return { ...result, page: filteredPage }
  }

  return result
}
