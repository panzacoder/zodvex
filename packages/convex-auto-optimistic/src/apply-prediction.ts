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
 * Per-entry context for applying a prediction. `queryArgs` is the args object
 * of the cached query entry — needed to tell first pages (cursor null) apart
 * from later pages when placing paginated inserts.
 */
export type ApplyContext = {
  queryArgs?: unknown
}

/**
 * Apply a mutation prediction to a single cached query result.
 *
 * The result shape is inferred at runtime; supported shapes are:
 *   - `Document[]` — standard list-style query
 *   - `Document | null` — `.first()`, `.unique()`, `ctx.db.get()` queries
 *   - `{ page, isDone, continueCursor }` — paginated queries (insert requires
 *     an `at` placement hint; patch/delete always apply)
 *
 * Returns the patched result or the input unchanged if the shape is not
 * recognized or the prediction doesn't apply.
 */
export function applyPrediction(
  result: unknown,
  prediction: Prediction,
  context: ApplyContext = {}
): unknown {
  // Query not yet loaded — don't invent a value. Convex's subscription will
  // populate it later; any optimistic state here would be misleading.
  if (result === undefined) return undefined

  if (prediction.kind === 'insert')
    return applyInsert(result, prediction.doc, prediction.at, context)
  if (prediction.kind === 'patch') return applyPatch(result, prediction.id, prediction.changes)
  if (prediction.kind === 'delete') return applyDelete(result, prediction.id)

  return result
}

function applyInsert(
  result: unknown,
  doc: { _id: string; [k: string]: unknown },
  at: 'start' | 'end' | undefined,
  context: ApplyContext
): unknown {
  if (Array.isArray(result)) {
    // Avoid duplicating: if the doc is already there (by _id), leave it.
    const already = result.some((r) => hasId(r) && r._id === doc._id)
    if (already) return result
    return at === 'start' ? [doc, ...result] : [...result, doc]
  }

  if (result === null) {
    // A `.first()`/`.unique()`-style query that previously returned null
    // now predictably returns the new doc.
    return doc
  }

  if (isPaginationResult(result)) {
    // Without a placement hint we can't know which page the doc belongs on —
    // err on the side of not mis-ordering.
    if (at === undefined) return result

    const already = result.page.some((r) => hasId(r) && r._id === doc._id)
    if (already) return result

    if (at === 'start') {
      // Only the first page — the cached entry whose cursor is null.
      if (!isFirstPageArgs(context.queryArgs)) return result
      return { ...result, page: [doc, ...result.page] }
    }

    // at === 'end': only the final page.
    if (!result.isDone) return result
    return { ...result, page: [...result.page, doc] }
  }

  return result
}

/**
 * Convex paginated queries take their cursor via an argument named
 * `paginationOpts` (enforced by `usePaginatedQuery` and the
 * `paginationOptsValidator`). The first page is the one requested with a
 * null cursor.
 */
function isFirstPageArgs(queryArgs: unknown): boolean {
  if (!queryArgs || typeof queryArgs !== 'object') return false
  const opts = (queryArgs as Record<string, unknown>).paginationOpts
  if (!opts || typeof opts !== 'object') return false
  return (opts as Record<string, unknown>).cursor === null
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
