import { applyPrediction } from './apply-prediction'
import { resolveAffectedQueries, resolveInsertPlacement } from './find-queries'
import type { DiagnosticHandler, Prediction, TableGraphLike } from './types'

/**
 * Minimal interface mirroring convex/react's OptimisticLocalStore. We avoid
 * importing the type directly so this module can be tested without Convex.
 * The structural match means real Convex OptimisticLocalStore satisfies it.
 */
export type LocalStoreLike = {
  getAllQueries: (ref: unknown) => Array<{ args: unknown; value: unknown }>
  setQuery: (ref: unknown, args: unknown, value: unknown) => void
}

export type ApplyPredictionOptions = {
  graph: TableGraphLike
  apiRoot: unknown
  mutationPath: string
  onDiagnostic?: DiagnosticHandler
}

/**
 * Apply a mutation's prediction to every cached instance of every affected query.
 *
 * This is the core of the auto-optimistic flow. It:
 *   1. Uses the graph to find query paths that read tables the mutation writes.
 *   2. Resolves each path to a FunctionReference via the api object.
 *   3. Iterates all cached (args, value) pairs for that query.
 *   4. Runs applyPrediction on each value and writes back any changes.
 */
export function applyPredictionToStore(
  store: LocalStoreLike,
  prediction: Prediction,
  opts: ApplyPredictionOptions
): void {
  const { graph, apiRoot, mutationPath, onDiagnostic } = opts

  const { resolved, unresolved } = resolveAffectedQueries(graph, apiRoot, mutationPath)

  if (unresolved.length > 0 && onDiagnostic) {
    for (const path of unresolved) {
      onDiagnostic({
        severity: 'warning',
        message: `Could not resolve query reference from api for path "${path}" — skipping optimistic update for this query`,
        mutation: mutationPath,
        query: path
      })
    }
  }

  for (const { path, ref } of resolved) {
    // Per-query insert placement from the graph's statically extracted
    // orderings beats the prediction's per-mutation `at` hint — the graph
    // knows THIS query's ordering; the hint is a one-size-for-all fallback.
    let effectivePrediction = prediction
    if (prediction.kind === 'insert') {
      const placement = resolveInsertPlacement(graph, mutationPath, path)
      if (placement && placement !== prediction.at) {
        effectivePrediction = { ...prediction, at: placement }
      }
    }

    let entries: Array<{ args: unknown; value: unknown }>
    try {
      entries = store.getAllQueries(ref)
    } catch (err) {
      onDiagnostic?.({
        severity: 'warning',
        message: `getAllQueries threw for query "${path}": ${String(err)}`,
        mutation: mutationPath,
        query: path
      })
      continue
    }

    for (const { args, value } of entries) {
      const nextValue = applyPrediction(value, effectivePrediction, { queryArgs: args })
      if (nextValue !== value) {
        store.setQuery(ref, args, nextValue)
      }
    }
  }
}
