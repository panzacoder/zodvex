/**
 * React integration: `createAutoOptimistic({ graph, api })` returns hooks that
 * wrap Convex's `useMutation` with automatic optimistic updates driven by the
 * table graph.
 *
 * This module imports from 'convex/react' and 'react', so it's isolated in its
 * own entrypoint to keep the core package usable from non-React environments.
 */

import { useMemo } from 'react'
import { useMutation } from 'convex/react'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { applyPredictionToStore, type LocalStoreLike } from './apply-to-store'
import type {
  AutoOptimisticDiagnostic,
  DiagnosticHandler,
  Prediction,
  TableGraphLike
} from './types'

export type AutoOptimisticConfig = {
  graph: TableGraphLike
  /**
   * The Convex `api` object (typically imported from `./convex/_generated/api`).
   * Used to resolve function paths in the graph back to callable FunctionReferences.
   */
  api: unknown
  /**
   * Optional handler for diagnostics emitted during optimistic updates —
   * e.g., a query reference that couldn't be resolved from the api object.
   *
   * In development this is useful for surfacing graph/config mismatches.
   * In production you may want to send them to your logging service or omit.
   *
   * Default: logs to console.warn in non-production.
   */
  onDiagnostic?: DiagnosticHandler
}

export type PredictFn<M extends FunctionReference<'mutation'>> = (
  args: FunctionArgs<M>
) => Prediction | null | undefined

export type UseAutoMutationResult<M extends FunctionReference<'mutation'>> = (
  args: FunctionArgs<M>
) => Promise<FunctionReturnType<M>>

const isProduction =
  typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production'

function defaultDiagnosticHandler(d: AutoOptimisticDiagnostic): void {
  if (isProduction) return
  const scope = d.mutation ? ` [${d.mutation}]` : ''
  const queryScope = d.query ? ` (query: ${d.query})` : ''
  // biome-ignore lint/suspicious/noConsole: development diagnostic
  console.warn(`[convex-auto-optimistic]${scope}${queryScope} ${d.message}`)
}

/**
 * Create a set of auto-optimistic hooks bound to a given table graph + api.
 *
 * ```ts
 * const { useAutoMutation } = createAutoOptimistic({
 *   graph: tableGraph,
 *   api
 * })
 *
 * const createTask = useAutoMutation(api.tasks.create, (args) => ({
 *   kind: 'insert',
 *   doc: { ...args, _id: crypto.randomUUID(), _creationTime: Date.now() }
 * }))
 * ```
 */
export function createAutoOptimistic(config: AutoOptimisticConfig): {
  useAutoMutation: <M extends FunctionReference<'mutation'>>(
    mutationRef: M,
    predict: PredictFn<M>
  ) => UseAutoMutationResult<M>
} {
  const onDiagnostic = config.onDiagnostic ?? defaultDiagnosticHandler

  function useAutoMutation<M extends FunctionReference<'mutation'>>(
    mutationRef: M,
    predict: PredictFn<M>
  ): UseAutoMutationResult<M> {
    const rawMutation = useMutation(mutationRef)

    const mutationPath = useMemo(() => getPath(mutationRef), [mutationRef])

    return useMemo(() => {
      if (!mutationPath) {
        onDiagnostic({
          severity: 'warning',
          message:
            'Could not determine mutation path from FunctionReference. Optimistic updates disabled for this mutation.'
        })
        return rawMutation as UseAutoMutationResult<M>
      }

      const info = config.graph.functions[mutationPath]
      if (!info) {
        onDiagnostic({
          severity: 'warning',
          message: `Mutation path "${mutationPath}" not found in the table graph. Optimistic updates disabled.`,
          mutation: mutationPath
        })
        return rawMutation as UseAutoMutationResult<M>
      }

      return rawMutation.withOptimisticUpdate((store, args) => {
        const prediction = predict(args)
        if (!prediction) return
        applyPredictionToStore(store as unknown as LocalStoreLike, prediction, {
          graph: config.graph,
          apiRoot: config.api,
          mutationPath,
          onDiagnostic
        })
      }) as UseAutoMutationResult<M>
    }, [rawMutation, mutationPath, predict])
  }

  return { useAutoMutation }
}

/**
 * Well-known symbol Convex uses to tag function references with their path.
 * Declared with `Symbol.for(...)` so it stays stable across Convex package
 * versions — the registry entry is shared process-wide.
 */
const FUNCTION_NAME = Symbol.for('functionName')

/**
 * Extract a Convex function path (e.g. "tasks:create") from a FunctionReference.
 *
 * Reads the well-known `functionName` symbol directly. Falls back to probing
 * plain-string fields for forward-compatibility with any convex-adjacent
 * tooling that wraps references.
 */
function getPath(ref: unknown): string | null {
  if (!ref || typeof ref !== 'object') return null
  const obj = ref as Record<string | symbol, unknown>

  const fromSymbol = obj[FUNCTION_NAME]
  if (typeof fromSymbol === 'string') return fromSymbol

  const direct = (obj as Record<string, unknown>).functionName
  if (typeof direct === 'string') return direct

  return null
}
