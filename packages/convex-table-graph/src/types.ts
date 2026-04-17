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

export type FunctionInfo = {
  /** e.g. "tasks:create" */
  path: string
  kind: FunctionKind
  visibility: Visibility
  /** Tables read by this function */
  reads: string[]
  /** Tables written by this function */
  writes: string[]
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

export type AnalyzeOptions = {
  /** Absolute path to the convex/ directory */
  convexDir: string
  /**
   * Names of function-builder calls to recognize. Extend this when using wrappers
   * like `zQuery`, `zMutation`, or custom `customQuery` builders.
   */
  builders?: Partial<BuilderConfig>
  /** Max depth to follow function calls when walking db taint. Default 3. */
  maxDepth?: number
  /** Additional tsconfig-compatible compiler options for ts-morph. */
  tsConfigFilePath?: string
}
