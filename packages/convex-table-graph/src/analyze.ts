import path from 'node:path'
import { Project, type SourceFile } from 'ts-morph'
import { analyzeHandler } from './analyze-handler'
import { discoverEntryFiles, functionPath, moduleNameFromPath } from './discovery'
import { getNodeLocation, identifyFunctions } from './identify'
import {
  type AnalyzeOptions,
  type BuilderConfig,
  DEFAULT_BUILDERS,
  type FunctionInfo,
  type TableGraph
} from './types'

/**
 * Analyze a Convex project and produce a table-dependency graph.
 *
 * This is a pure function: given a convex/ directory, it reads source code,
 * walks the AST, and returns the graph plus any diagnostics. It does not execute
 * user code, require a Convex runtime, or touch the filesystem beyond reading.
 */
export function analyze(options: AnalyzeOptions): TableGraph {
  const convexDir = path.resolve(options.convexDir)
  const builders = mergeBuilders(options.builders)
  const maxDepth = options.maxDepth ?? 3
  const dbFactories = new Set(options.dbFactories ?? [])

  const project = createProject(convexDir, options.tsConfigFilePath)

  const relFiles = discoverEntryFiles(convexDir)
  const graph: TableGraph = {
    version: 1,
    convexDir,
    functions: {},
    diagnostics: []
  }

  for (const rel of relFiles) {
    const abs = path.join(convexDir, rel)
    const sourceFile = project.addSourceFileAtPathIfExists(abs)
    if (!sourceFile) continue

    analyzeSourceFile(sourceFile, rel, builders, maxDepth, dbFactories, convexDir, graph)
  }

  applyOverrides(graph, options.overrides)

  return graph
}

/**
 * Apply manual per-function table declarations (see AnalyzeOptions.overrides):
 * declared tables are unioned in, the function is promoted to full confidence,
 * and its diagnostics are dropped. Unknown paths get a warning so typos surface.
 */
function applyOverrides(graph: TableGraph, overrides: AnalyzeOptions['overrides']): void {
  if (!overrides) return

  const overriddenPaths = new Set<string>()

  for (const [fnPath, override] of Object.entries(overrides)) {
    const info = graph.functions[fnPath]
    if (!info) {
      graph.diagnostics.push({
        severity: 'warning',
        file: '',
        line: 0,
        column: 0,
        message: `Override for "${fnPath}" matches no analyzed function`,
        code: 'unknown-override'
      })
      continue
    }

    info.reads = Array.from(new Set([...info.reads, ...(override.reads ?? [])])).sort()
    info.writes = Array.from(new Set([...info.writes, ...(override.writes ?? [])])).sort()
    info.confidence = 'full'
    overriddenPaths.add(fnPath)
  }

  if (overriddenPaths.size > 0) {
    graph.diagnostics = graph.diagnostics.filter(
      (d) => !d.function || !overriddenPaths.has(d.function)
    )
  }
}

function analyzeSourceFile(
  sourceFile: SourceFile,
  relFile: string,
  builders: BuilderConfig,
  maxDepth: number,
  dbFactories: Set<string>,
  convexDir: string,
  graph: TableGraph
): void {
  const moduleName = moduleNameFromPath(relFile)
  const identified = identifyFunctions(sourceFile, builders)

  for (const fn of identified) {
    const path = functionPath(moduleName, fn.exportName)
    const loc = getNodeLocation(fn.builderCall)
    const absSource = sourceFile.getFilePath()
    const relSource = toRelative(convexDir, absSource) ?? absSource

    const analysis = analyzeHandler(fn.handler, {
      maxDepth,
      visited: new Set(),
      functionPath: path,
      dbFactories
    })

    // Remap diagnostic file paths to be relative to convexDir for portability.
    for (const diag of analysis.diagnostics) {
      const rel = toRelative(convexDir, diag.file)
      graph.diagnostics.push({
        ...diag,
        file: rel ?? diag.file
      })
    }

    const info: FunctionInfo = {
      path,
      kind: fn.kind,
      visibility: fn.visibility,
      reads: Array.from(analysis.reads).sort(),
      writes: Array.from(analysis.writes).sort(),
      confidence: analysis.partial ? 'partial' : 'full',
      sourceFile: relSource,
      location: {
        file: relSource,
        line: loc.line,
        column: loc.column
      }
    }

    // Result orderings only make sense for subscribable results — attach for
    // query kinds, dropping tables whose chains conflicted.
    if (fn.kind === 'query' || fn.kind === 'internalQuery') {
      const orderings = Array.from(analysis.orderings.values())
        .filter((o): o is Exclude<typeof o, 'conflict'> => o !== 'conflict')
        .sort((a, b) => a.table.localeCompare(b.table))
      if (orderings.length > 0) info.resultOrderings = orderings
    }

    graph.functions[path] = info
  }
}

function mergeBuilders(overrides?: Partial<BuilderConfig>): BuilderConfig {
  if (!overrides) return DEFAULT_BUILDERS

  const merged: BuilderConfig = {
    query: [...DEFAULT_BUILDERS.query],
    mutation: [...DEFAULT_BUILDERS.mutation],
    action: [...DEFAULT_BUILDERS.action],
    internalQuery: [...DEFAULT_BUILDERS.internalQuery],
    internalMutation: [...DEFAULT_BUILDERS.internalMutation],
    internalAction: [...DEFAULT_BUILDERS.internalAction],
    httpAction: [...DEFAULT_BUILDERS.httpAction]
  }

  for (const [kind, extras] of Object.entries(overrides) as [keyof BuilderConfig, string[]][]) {
    if (!extras) continue
    const existing = new Set(merged[kind])
    for (const name of extras) existing.add(name)
    merged[kind] = Array.from(existing)
  }

  return merged
}

function createProject(convexDir: string, tsConfigFilePath?: string): Project {
  if (tsConfigFilePath) {
    return new Project({
      tsConfigFilePath,
      skipAddingFilesFromTsConfig: true
    })
  }

  // Best-effort: look for a tsconfig in the convex/ directory itself, then parent.
  const candidates = [
    path.join(convexDir, 'tsconfig.json'),
    path.join(convexDir, '..', 'tsconfig.json')
  ]

  for (const candidate of candidates) {
    try {
      return new Project({
        tsConfigFilePath: candidate,
        skipAddingFilesFromTsConfig: true
      })
    } catch {
      // try next
    }
  }

  // Fallback: in-memory project with reasonable defaults.
  return new Project({
    compilerOptions: {
      target: 99, // Latest
      module: 99, // NodeNext
      moduleResolution: 2, // Node
      strict: true,
      allowJs: true,
      skipLibCheck: true
    }
  })
}

function toRelative(from: string, target: string): string | null {
  try {
    const rel = path.relative(from, target)
    if (!rel || rel.startsWith('..')) return null
    return rel.split(path.sep).join('/')
  } catch {
    return null
  }
}
