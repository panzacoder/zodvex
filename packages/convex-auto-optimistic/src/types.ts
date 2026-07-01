/**
 * Subset of the convex-table-graph output that this package actually consumes.
 *
 * Declared locally to avoid a hard dependency on convex-table-graph at runtime —
 * consumers can pass any object that conforms to this shape. This also decouples
 * release cycles between the two packages.
 */

export type FunctionKind =
  | 'query'
  | 'mutation'
  | 'action'
  | 'internalQuery'
  | 'internalMutation'
  | 'internalAction'
  | 'httpAction'

export type Visibility = 'public' | 'internal'

export type FunctionInfo = {
  kind: FunctionKind
  visibility: Visibility
  reads: readonly string[]
  writes: readonly string[]
}

export type TableGraphLike = {
  functions: Readonly<Record<string, FunctionInfo>>
}

/**
 * A description of what a mutation is expected to do, used to patch every
 * cached query that reads an affected table.
 */
export type Prediction =
  | {
      kind: 'insert'
      doc: DocumentLike
      /**
       * Where the inserted doc should land in ordered results.
       *
       * - `'start'` — prepend. For paginated queries, applies only to the
       *   first page (the cached entry whose `paginationOpts.cursor` is null).
       * - `'end'` — append (default for plain arrays). For paginated queries,
       *   applies only to the final page (`isDone: true`).
       * - omitted — plain arrays append; paginated results are skipped
       *   (ordering semantics unknown).
       */
      at?: 'start' | 'end'
    }
  | {
      kind: 'patch'
      id: string
      changes: Record<string, unknown>
    }
  | {
      kind: 'delete'
      id: string
    }

/**
 * Convex documents always carry at least an `_id` and `_creationTime`.
 * We use `_id` to match patch/delete targets in existing query results.
 */
export type DocumentLike = {
  _id: string
  _creationTime?: number
  [field: string]: unknown
}

export type AutoOptimisticDiagnostic = {
  severity: 'warning' | 'error'
  message: string
  /** Mutation path, if known (e.g., "tasks:create") */
  mutation?: string
  /** Query path, if the diagnostic is scoped to a specific query */
  query?: string
}

export type DiagnosticHandler = (diagnostic: AutoOptimisticDiagnostic) => void
