export type FunctionKind =
  | 'query'
  | 'mutation'
  | 'action'
  | 'internalQuery'
  | 'internalMutation'
  | 'internalAction'
  | 'httpAction'

export type Visibility = 'public' | 'internal'

export type Confidence = 'full' | 'partial'

export type DiagnosticSeverity = 'warning' | 'error'

export type Diagnostic = {
  severity: DiagnosticSeverity
  /** Function path (e.g. "tasks:create") or undefined for file-level diagnostics */
  function?: string
  file: string
  line: number
  column: number
  message: string
  /** Optional machine-readable reason code */
  code?: string
}

export type SourceLocation = {
  file: string
  line: number
  column: number
}

/**
 * The result ordering of a query function's list-shaped output for one table,
 * extracted from a complete `db.query(table)...order(...)…collect/take/paginate`
 * chain. Only present when every list-producing chain for the table agrees.
 *
 * `byCreationTime` is true when the chain uses the default index (or
 * `by_creation_time` explicitly) — the only case where the position of a
 * newly inserted doc is statically knowable (new docs have the max
 * `_creationTime`): desc → start of results, asc → end.
 */
export type ResultOrdering = {
  table: string
  direction: 'asc' | 'desc'
  byCreationTime: boolean
}

export type FunctionInfo = {
  /** e.g. "tasks:create" */
  path: string
  kind: FunctionKind
  visibility: Visibility
  /** Tables read by this function */
  reads: string[]
  /** Tables written by this function */
  writes: string[]
  /**
   * Per-table result orderings for query functions (see ResultOrdering).
   * Omitted when nothing could be confidently extracted.
   */
  resultOrderings?: ResultOrdering[]
  /** full = all paths resolved; partial = some db access unresolved */
  confidence: Confidence
  /** Relative source file path (from cwd or convex root) */
  sourceFile: string
  /** Location of the exported declaration */
  location: SourceLocation
}

export type TableGraph = {
  version: 1
  /** Root directory that was analyzed (absolute) */
  convexDir: string
  /** Keyed by function path (e.g. "tasks:create") */
  functions: Record<string, FunctionInfo>
  diagnostics: Diagnostic[]
}

export type BuilderConfig = {
  query: string[]
  mutation: string[]
  action: string[]
  internalQuery: string[]
  internalMutation: string[]
  internalAction: string[]
  httpAction: string[]
}

export const DEFAULT_BUILDERS: BuilderConfig = {
  query: ['query'],
  mutation: ['mutation'],
  action: ['action'],
  internalQuery: ['internalQuery'],
  internalMutation: ['internalMutation'],
  internalAction: ['internalAction'],
  httpAction: ['httpAction']
}

/**
 * Manual declaration of tables a function touches, for code the analyzer
 * can't resolve (dynamic table names, external callees). Declared tables are
 * unioned with whatever the analyzer found, the function is promoted to full
 * confidence, and its diagnostics are dropped — the developer takes
 * responsibility for completeness.
 */
export type FunctionOverride = {
  reads?: string[]
  writes?: string[]
}

export type AnalyzeOptions = {
  /** Absolute path to the convex/ directory */
  convexDir: string
  /**
   * Names of function-builder calls to recognize. Extend this when using wrappers
   * like `zQuery`, `zMutation`, or custom `customQuery` builders.
   */
  builders?: Partial<BuilderConfig>
  /**
   * Names of free functions that return a db-like object when passed a db
   * (e.g. zodvex's `zodvexStream`). Calls to these with a tainted db argument
   * are treated as db references, so `zodvexStream(ctx.db, schema).query("t")`
   * records a read of "t".
   */
  dbFactories?: string[]
  /** Per-function manual table declarations, keyed by function path ("tasks:create"). */
  overrides?: Record<string, FunctionOverride>
  /** Max depth to follow function calls when walking db taint. Default 3. */
  maxDepth?: number
  /** Additional tsconfig-compatible compiler options for ts-morph. */
  tsConfigFilePath?: string
}
