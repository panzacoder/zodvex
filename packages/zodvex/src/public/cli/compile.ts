/**
 * zodvex compile
 *
 * Build-time transform that rewrites `zq`/`zm`/`za` (and internal variants)
 * call sites into vanilla Convex `query`/`mutation`/`action` calls with
 * pre-extracted `v.*` validator literals. The Zod schemas are evaluated at
 * build time, converted via the existing runtime `zodToConvex` machinery,
 * and emitted as Convex source — so the push-time isolate carries only
 * Convex validators, not retained Zod schema instances.
 *
 * Phase 1 scope: pure-validator endpoints. Endpoints with transforms /
 * refines / codecs in args or returns are left as-is (still pay the full
 * zodvex cost). The transform is best-effort per call site — a file may
 * have some calls converted and others left intact.
 */
import fs from 'node:fs'
import path from 'node:path'
import { globSync } from 'tinyglobby'
import { zodToConvex, zodToConvexFields } from '../../internal/mapping'
import { $ZodObject } from '../../internal/zod-core'
import { type DiscoveredFunction, type DiscoveredModel, discoverModules } from '../codegen/discover'
import {
  convexArgsToSource,
  convexValidatorToSource,
  createSharingContext,
  registerModelFields,
  type SharingContext
} from './compileSerialize'

const ZQ_NAMES = ['zq', 'zm', 'za', 'ziq', 'zim', 'zia'] as const
const ZQ_TO_BUILDER: Record<(typeof ZQ_NAMES)[number], string> = {
  zq: 'query',
  zm: 'mutation',
  za: 'action',
  ziq: 'internalQuery',
  zim: 'internalMutation',
  zia: 'internalAction'
}

export type CompileOptions = {
  dryRun?: boolean
  verbose?: boolean
}

export type CompileResult = {
  filesChanged: number
  transformedCalls: number
  skipped: number
}

type ResolvedFunction = {
  exportName: string
  sourceFile: string // relative to convexDir
  argsSource: string | undefined
  returnsSource: string | undefined
  /** `*Fields` record names referenced via Phase-2 sharing in args/returns. */
  usedRecords: Set<string>
}

type ResolvedModel =
  | {
      kind: 'shape'
      exportName: string
      sourceFile: string
      /** The identifier the user (or compile) uses to export this model's fields. */
      fieldsRecordName: string
      /** Convex validator record (the value of `*Fields` after compile). */
      convexFields: Record<string, unknown>
      /**
       * Whether the user's source already declares `export const *Fields = {...}`.
       * Drives whether the model transform rewrites in place vs hoists a new const.
       */
      recordExists: boolean
    }
  | {
      /**
       * Union / discriminated-union model — `defineZodModel(name, unionSchema)`.
       * No shape record to share; we emit `defineTable(<v.union literal>)` and
       * let cross-file prune drop the original Zod schema declaration.
       */
      kind: 'union'
      exportName: string
      sourceFile: string
      validatorSource: string
    }

export async function runCompile(
  targetDir: string,
  options: CompileOptions = {}
): Promise<CompileResult> {
  const profile = options.verbose
  const t0 = Date.now()
  const lap = (label: string, since: number) => {
    if (profile) console.log(`  [perf] ${label}: ${((Date.now() - since) / 1000).toFixed(2)}s`)
  }
  const { Project } = await import('ts-morph')
  lap('ts-morph load', t0)

  const convexDir = path.resolve(process.cwd(), targetDir)
  if (!fs.existsSync(convexDir)) {
    throw new Error(`Directory not found: ${convexDir}`)
  }

  console.log(
    `[zodvex compile] ${options.dryRun ? 'Dry run — ' : ''}Discovering modules in ${path.relative(process.cwd(), convexDir) || '.'}/`
  )

  const tDiscover = Date.now()
  const discovered = await discoverModules(convexDir)
  lap('discoverModules', tDiscover)

  // Pass A: pre-resolve every model — we need the *Fields names *before* we
  // serialize any function args/returns so the sharing context is fully
  // populated when endpoint emission happens.
  const modelIndex = new Map<string, Map<string, ResolvedModel>>()
  const sharingCtx = createSharingContext()
  for (const m of discovered.models) {
    const resolved = preResolveModel(m, convexDir, options.verbose)
    if (!resolved) continue
    let bucket = modelIndex.get(m.sourceFile)
    if (!bucket) {
      bucket = new Map()
      modelIndex.set(m.sourceFile, bucket)
    }
    bucket.set(m.exportName, resolved)
    if (resolved.kind === 'shape') {
      registerModelFields(sharingCtx, resolved.fieldsRecordName, resolved.convexFields, m.tableName)
    }
  }

  // Pass B: resolve every function's args/returns *with* the sharing context.
  // Leaves and object subsets that match a model's fields become references /
  // spreads in the emitted source, dropping per-endpoint validator allocations.
  const fnIndex = new Map<string, Map<string, ResolvedFunction>>()
  for (const fn of discovered.functions) {
    const resolved = resolveFunctionToConvexSource(fn, sharingCtx, options.verbose)
    let bucket = fnIndex.get(fn.sourceFile)
    if (!bucket) {
      bucket = new Map()
      fnIndex.set(fn.sourceFile, bucket)
    }
    bucket.set(fn.exportName, resolved)
  }

  // Schema files: any .ts file that imports `defineZodSchema` from
  // `'zodvex'` / `'zodvex/server'`. Scan globally so we catch the user's
  // schema.ts even if it has no zodvex meta of its own.
  const schemaFiles = findSchemaFiles(convexDir)

  const candidateFiles = new Set<string>([...fnIndex.keys(), ...modelIndex.keys(), ...schemaFiles])
  if (candidateFiles.size === 0) {
    console.log('[zodvex compile] No zodvex usages found.')
    return { filesChanged: 0, transformedCalls: 0, skipped: 0 }
  }

  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, target: 99 } // ESNext
  })

  // Add ALL .ts files in convexDir to the project so the cross-file prune
  // pass below has the full picture of which exports are still referenced.
  const allFiles = globSync(['**/*.ts'], {
    cwd: convexDir,
    ignore: ['_generated/**', '_zodvex/**', 'node_modules/**', '**/*.d.ts']
  })
  const tAdd = Date.now()
  for (const rel of allFiles) {
    const abs = path.resolve(convexDir, rel)
    project.addSourceFileAtPath(abs)
  }
  lap(`addSourceFileAtPath × ${allFiles.length}`, tAdd)

  let filesChanged = 0
  let transformedCalls = 0
  let skipped = 0

  const transformedFiles = new Set<import('ts-morph').SourceFile>()

  // Record-name -> source file map for relative-import computation.
  const recordSources = new Map<string, string>()
  for (const bucket of modelIndex.values()) {
    for (const m of bucket.values()) {
      if (m.kind === 'shape') {
        recordSources.set(m.fieldsRecordName, m.sourceFile)
      }
    }
  }

  const tTransform = Date.now()
  for (const relFile of candidateFiles) {
    const absFile = path.resolve(convexDir, relFile)
    if (!fs.existsSync(absFile)) continue

    const sf = project.getSourceFile(absFile)
    if (!sf) continue
    const fnBucket = fnIndex.get(relFile)
    const modelBucket = modelIndex.get(relFile)
    const isSchemaFile = schemaFiles.has(relFile)

    const tFile = Date.now()
    const result = transformSourceFile(sf, fnBucket, modelBucket, isSchemaFile, {
      convexDir,
      verbose: options.verbose,
      recordSources
    })
    if (profile) console.log(`  [perf]   transform ${relFile}: ${((Date.now() - tFile) / 1000).toFixed(2)}s, ${result.transformed} changes`)

    if (result.transformed > 0) {
      filesChanged++
      transformedCalls += result.transformed
      transformedFiles.add(sf)
    }
    skipped += result.skipped
  }
  lap(`transformSourceFile × ${candidateFiles.size}`, tTransform)

  // Cross-file prune pass: any exported declaration in a transformed file
  // that has no remaining references project-wide can be dropped, taking its
  // imports with it. Catches `taskFields` (only ever read by endpoints, which
  // are now compiled to v.* literals) without needing per-file heuristics.
  const tPrune = Date.now()
  pruneUnusedExportsAcrossProject(project, transformedFiles)
  lap('pruneUnusedExportsAcrossProject', tPrune)
  const tSave = Date.now()

  for (const sf of transformedFiles) {
    if (options.dryRun) {
      if (options.verbose) {
        const rel = path.relative(convexDir, sf.getFilePath())
        console.log(`  would change: ${rel}`)
      }
    } else {
      sf.saveSync()
      if (options.verbose) {
        const rel = path.relative(convexDir, sf.getFilePath())
        console.log(`  changed: ${rel}`)
      }
    }
  }
  lap('saveSync × transformedFiles', tSave)
  lap('runCompile total', t0)

  return { filesChanged, transformedCalls, skipped }
}

/**
 * For every exported `const` in a transformed file, check whether any other
 * source file in the project references that identifier text. If not, drop
 * the declaration. Then re-run per-file import pruning so newly-dead imports
 * fall away. Pure text-match (not type-checker) — fast and correct enough
 * for the conservative case of "nobody uses this name anywhere else".
 */
/**
 * Builds a per-file identifier usage map in ONE forEachDescendant walk.
 *
 *   appearances:    every standalone Identifier node, by text
 *   declarationSites: identifier-text → number of nodes that are the
 *                     name of a declaration (top-level const, import
 *                     specifier). These are appearances that DON'T count
 *                     as references.
 *
 * "Reference count" for a name = appearances - declarationSites. When zero
 * (or, more precisely, when no node outside a given declaration's subtree
 * uses the name), the declaration is unused. The full file is scanned
 * once; per-decl checks become O(1) map lookups instead of fresh walks.
 */
function buildFileUsageMap(sf: import('ts-morph').SourceFile): {
  appearances: Map<string, number>
  declarationSites: Map<string, number>
} {
  const appearances = new Map<string, number>()
  const declarationSites = new Map<string, number>()
  sf.forEachDescendant(node => {
    if (!isIdentifier(node)) return
    const text = node.getText()
    appearances.set(text, (appearances.get(text) ?? 0) + 1)
    const parent = node.getParent()
    if (!parent) return
    const parentKind = parent.getKindName()
    // Identifier is the *name* of a top-level `const X = ...`, an import
    // specifier, or a default/namespace import. These are declaration
    // sites, not references. (We treat ALL VariableDeclaration name
    // identifiers this way — module-level only matters for our pruner,
    // which only checks top-level const decls.)
    if (parentKind === 'ImportSpecifier' && (parent as any).getNameNode?.() === node) {
      declarationSites.set(text, (declarationSites.get(text) ?? 0) + 1)
      return
    }
    if (parentKind === 'ImportClause' && (parent as any).getDefaultImport?.() === node) {
      declarationSites.set(text, (declarationSites.get(text) ?? 0) + 1)
      return
    }
    if (parentKind === 'NamespaceImport' && (parent as any).getNameNode?.() === node) {
      declarationSites.set(text, (declarationSites.get(text) ?? 0) + 1)
      return
    }
    if (parentKind === 'VariableDeclaration' && (parent as any).getNameNode?.() === node) {
      declarationSites.set(text, (declarationSites.get(text) ?? 0) + 1)
      return
    }
  })
  return { appearances, declarationSites }
}

function isReferencedInFile(name: string, usage: ReturnType<typeof buildFileUsageMap>): boolean {
  const total = usage.appearances.get(name) ?? 0
  const decl = usage.declarationSites.get(name) ?? 0
  return total > decl
}

function pruneUnusedExportsAcrossProject(
  project: import('ts-morph').Project,
  transformedFiles: Set<import('ts-morph').SourceFile>
): void {
  // Build a project-wide usage map (one forEachDescendant per file) so we
  // can ask O(1) per export whether the name is referenced anywhere.
  const projectAppearances = new Map<string, number>()
  const projectDeclSites = new Map<string, number>()
  for (const sf of project.getSourceFiles()) {
    const u = buildFileUsageMap(sf)
    for (const [k, v] of u.appearances) {
      projectAppearances.set(k, (projectAppearances.get(k) ?? 0) + v)
    }
    for (const [k, v] of u.declarationSites) {
      projectDeclSites.set(k, (projectDeclSites.get(k) ?? 0) + v)
    }
  }

  // Per file: collect deletion ranges for unused exports, apply once.
  // Per-decl `.remove()` was quadratic on monolithic files (each mutation
  // re-parses the surrounding statement list).
  for (const sf of transformedFiles) {
    const text = sf.getFullText()
    const deletions: TextEdit[] = []
    for (const stmt of sf.getVariableStatements()) {
      if (!stmt.hasExportKeyword()) continue
      const decls = stmt.getDeclarations()
      // Conservative: only drop the whole statement when *every* declared
      // name in it is unreferenced and pruneable. Statements with mixed
      // pruneable/non-pruneable initializers fall through.
      const allDroppable = decls.every(decl => {
        if (!isPruneableInitializer(decl.getInitializer())) return false
        const name = decl.getName()
        const total = projectAppearances.get(name) ?? 0
        const declsCount = projectDeclSites.get(name) ?? 0
        return total - declsCount <= 0
      })
      if (!allDroppable) continue
      let end = stmt.getEnd()
      if (text[end] === '\n') end++
      deletions.push({ start: stmt.getStart(), end, replacement: '' })
    }

    if (deletions.length > 0) {
      applyTextEdits(sf, deletions)
    }
    // Re-run per-file prune to mop up imports that just became dead.
    pruneUnusedSymbols(sf)
  }
}

/**
 * True when the initializer is *NOT* a Convex registration call — i.e., it's
 * safe to drop if no other file references it. The exclusion list covers
 * `query`/`mutation`/`action`/`internalQuery`/`internalMutation`/`internalAction`
 * (function registrations Convex discovers by filesystem walk) and
 * `defineTable`/`defineSchema` (table/schema registrations). Anything else —
 * pure data literals AND lingering Zod constructors (`z.object`, `z.union`,
 * `z.literal`, etc.) — is fair game once compile-away has rewritten the
 * registration call sites.
 */
function isPruneableInitializer(node: import('ts-morph').Node | undefined): boolean {
  if (!node) return false
  if (node.getKindName() !== 'CallExpression') return true
  const call = node as import('ts-morph').CallExpression
  const callee = call.getExpression()
  if (!isIdentifier(callee)) return true
  const name = callee.getText()
  return !PROTECTED_REGISTRATION_CALLS.has(name)
}

const PROTECTED_REGISTRATION_CALLS = new Set([
  'query',
  'mutation',
  'action',
  'internalQuery',
  'internalMutation',
  'internalAction',
  'defineTable',
  'defineSchema',
  // Convex-helpers builders, in case the user mixes flavors during migration.
  'zCustomQuery',
  'zCustomMutation',
  'zCustomAction'
])

function countIdentifierUsagesOutside(
  sf: import('ts-morph').SourceFile,
  name: string,
  exclude: import('ts-morph').Node
): number {
  let count = 0
  sf.forEachDescendant(node => {
    if (!isIdentifier(node)) return
    if (node.getText() !== name) return
    if (isInsideExcluded(node, exclude)) return
    count++
  })
  return count
}

/**
 * Discover the `*Fields` identifier name and Convex fields for one model.
 * - Reads `model.fields` from the live module ref.
 * - Greps the source file for `defineZodModel('table', <ident>, ...)` to find
 *   the user's existing record name. Falls back to `<camelCase(table)>Fields`
 *   if the source uses an inline shape.
 */
function preResolveModel(
  m: DiscoveredModel,
  convexDir: string,
  verbose?: boolean
): ResolvedModel | undefined {
  const ref = m._modelRef as { fields?: Record<string, unknown>; schema?: unknown } | undefined
  const fields = ref?.fields

  if (fields && typeof fields === 'object' && Object.keys(fields).length > 0) {
    // Shape model: build *Fields record + lookup name from source.
    let convexFields: Record<string, unknown>
    try {
      convexFields = zodToConvexFields(fields as Record<string, any>) as Record<string, unknown>
    } catch (err) {
      if (verbose) {
        console.warn(`  [skip model] ${m.sourceFile}:${m.exportName}: ${(err as Error).message}`)
      }
      return undefined
    }

    let recordName: string | undefined
    let recordExists = false
    try {
      const src = fs.readFileSync(path.join(convexDir, m.sourceFile), 'utf-8')
      const re = new RegExp(
        `defineZodModel\\(\\s*['"]${escapeForRegex(m.tableName)}['"]\\s*,\\s*([A-Za-z_$][\\w$]*)\\b`
      )
      const match = src.match(re)
      if (match) {
        recordName = match[1]
        const declRe = new RegExp(`(?:export\\s+)?const\\s+${recordName}\\s*=`)
        recordExists = declRe.test(src)
      }
    } catch {
      // fall through
    }
    if (!recordName) {
      recordName = `${camelCaseTableName(m.tableName)}Fields`
    }

    return {
      kind: 'shape',
      exportName: m.exportName,
      sourceFile: m.sourceFile,
      fieldsRecordName: recordName,
      convexFields,
      recordExists
    }
  }

  // Non-shape (union / discriminated-union) model. Both factories retain the
  // original schema as `userSchema` (slim path always, full path via the
  // build-tooling-only retention added in createModel). Convert it to a Convex
  // validator and emit `defineTable(<v.union literal>)`.
  const userSchema =
    (ref as { userSchema?: unknown } | undefined)?.userSchema ??
    (typeof (ref as { schema?: unknown } | undefined)?.schema === 'object' &&
    !(ref as { schema?: { doc?: unknown } } | undefined)?.schema?.doc
      ? (ref as { schema?: unknown }).schema
      : undefined)
  if (userSchema && typeof userSchema === 'object') {
    try {
      const convexValidator = zodToConvex(userSchema as any)
      const validatorSource = convexValidatorToSource(convexValidator)
      return {
        kind: 'union',
        exportName: m.exportName,
        sourceFile: m.sourceFile,
        validatorSource
      }
    } catch (err) {
      if (verbose) {
        console.warn(
          `  [skip union model] ${m.sourceFile}:${m.exportName}: ${(err as Error).message}`
        )
      }
    }
  }

  if (verbose) {
    console.warn(
      `  [skip model] ${m.sourceFile}:${m.exportName} — no fields and no resolvable union schema`
    )
  }
  return undefined
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 'comments_0001' → 'comment0001'; drops trailing 's' once for plural. */
function camelCaseTableName(table: string): string {
  // strip non-identifier chars
  let cleaned = table.replace(/[^A-Za-z0-9]/g, '')
  // singularize (cheap heuristic — only the trailing 's' if it follows a letter)
  if (/[a-zA-Z]s$/.test(cleaned)) cleaned = cleaned.slice(0, -1) + cleaned.slice(-1).toLowerCase()
  // simple singular: drop trailing 's' when there's no other better signal
  if (cleaned.endsWith('s') && cleaned.length > 1) cleaned = cleaned.slice(0, -1)
  return cleaned.charAt(0).toLowerCase() + cleaned.slice(1)
}

/**
 * Returns the set of (relative) `.ts` files in convexDir that import
 * `defineZodSchema` from `'zodvex'` or `'zodvex/server'`. Cheap — a regex
 * pre-filter avoids parsing every file.
 */
function findSchemaFiles(convexDir: string): Set<string> {
  const out = new Set<string>()
  const files = globSync(['**/*.ts'], {
    cwd: convexDir,
    ignore: ['_generated/**', '_zodvex/**', 'node_modules/**', '**/*.d.ts']
  })
  for (const rel of files) {
    let src: string
    try {
      src = fs.readFileSync(path.join(convexDir, rel), 'utf-8')
    } catch {
      continue
    }
    if (
      src.includes('defineZodSchema') &&
      (src.includes("'zodvex'") ||
        src.includes('"zodvex"') ||
        src.includes("'zodvex/server'") ||
        src.includes('"zodvex/server"'))
    ) {
      out.add(rel)
    }
  }
  return out
}

function resolveFunctionToConvexSource(
  fn: DiscoveredFunction,
  sharingCtx: SharingContext,
  verbose?: boolean
): ResolvedFunction {
  let argsSource: string | undefined
  let returnsSource: string | undefined
  const before = new Set(sharingCtx.usedRecords)

  // Compute the convex args/returns first so we can derive the function's
  // "primary records" (any model whose tableName appears in a v.id within
  // args or returns). Sharing is then scoped to those records — prevents
  // an endpoint for `tasks` from binding `body: v.string()` to
  // `commentFields.body` just because that name happens to also exist there.
  let convexArgs: Record<string, unknown> | undefined
  let convexReturns: unknown
  if (fn.zodArgs) {
    try {
      const argsObject = fn.zodArgs as unknown as InstanceType<typeof $ZodObject>
      const shape = argsObject instanceof $ZodObject ? argsObject._zod.def.shape : undefined
      if (shape) {
        convexArgs = zodToConvexFields(shape as Record<string, any>) as Record<string, unknown>
      }
    } catch (err) {
      if (verbose) {
        console.warn(`  [skip args] ${fn.functionPath}: ${(err as Error).message}`)
      }
    }
  }
  if (fn.zodReturns) {
    try {
      convexReturns = zodToConvex(fn.zodReturns as any)
    } catch (err) {
      if (verbose) {
        console.warn(`  [skip returns] ${fn.functionPath}: ${(err as Error).message}`)
      }
    }
  }

  const tablesTouched = new Set<string>()
  if (convexArgs) collectIdTables(convexArgs, tablesTouched)
  if (convexReturns) collectIdTables(convexReturns, tablesTouched)
  const preferredRecordNames = new Set<string>()
  for (const t of tablesTouched) {
    const record = sharingCtx.recordByTable.get(t)
    if (record) preferredRecordNames.add(record)
  }
  sharingCtx.preferredRecordNames = preferredRecordNames

  if (convexArgs) {
    argsSource = convexArgsToSource(convexArgs, sharingCtx)
  }
  if (convexReturns) {
    returnsSource = convexValidatorToSource(convexReturns, sharingCtx)
  }

  sharingCtx.preferredRecordNames = undefined

  // Diff `usedRecords` to capture only the additions from THIS function.
  const usedRecords = new Set<string>()
  for (const r of sharingCtx.usedRecords) {
    if (!before.has(r)) usedRecords.add(r)
  }

  return {
    exportName: fn.exportName,
    sourceFile: fn.sourceFile,
    argsSource,
    returnsSource,
    usedRecords
  }
}

/** Walks a Convex validator (or args record) and collects every `v.id(table)` table name. */
function collectIdTables(node: unknown, out: Set<string>): void {
  if (node == null || typeof node !== 'object') return
  const v = node as { kind?: string; tableName?: unknown; [k: string]: unknown }
  if (v.kind === 'id' && typeof v.tableName === 'string') {
    out.add(v.tableName)
    return
  }
  if (v.kind === 'object') {
    const fields = (v.fields ?? {}) as Record<string, unknown>
    for (const child of Object.values(fields)) collectIdTables(child, out)
    return
  }
  if (v.kind === 'union') {
    const members = (v.members ?? []) as unknown[]
    for (const child of members) collectIdTables(child, out)
    return
  }
  if (v.kind === 'array') {
    collectIdTables(v.element, out)
    return
  }
  if (v.kind === 'record') {
    collectIdTables((v as { value?: unknown }).value, out)
    return
  }
  // For args records (no `kind` field) — iterate values.
  if (typeof v.kind !== 'string') {
    for (const child of Object.values(node as Record<string, unknown>)) {
      collectIdTables(child, out)
    }
  }
}

type TransformContext = {
  convexDir: string
  verbose?: boolean
  /**
   * fieldsRecordName -> source file (relative to convexDir). Used to compute
   * relative import paths when an endpoint file references a model's `*Fields`
   * record via Phase-2 sharing.
   */
  recordSources: Map<string, string>
}

type TransformResult = {
  transformed: number
  skipped: number
}

interface TextEdit {
  start: number
  end: number
  replacement: string
}

/**
 * Applies a batch of text edits to a source file in ONE replaceWithText call.
 * Each ts-morph mutation (setInitializer, replaceWithText on a Node, etc.)
 * triggers an internal re-parse of the surrounding context — fine for small
 * files, but quadratic on monolithic source (~235ms per mutation × hundreds
 * of mutations = minutes). Collecting tuple-form edits and applying them as
 * a single replaceWithText drops the cost to O(file size).
 */
function applyTextEdits(sf: import('ts-morph').SourceFile, edits: TextEdit[]): void {
  if (edits.length === 0) return
  // Linear assembly: walk edits in ascending order, build the output text
  // as an array of chunks, then `join('')` once. The previous version did
  // `text = text.slice(...) + repl + text.slice(...)` per edit which is
  // O(file size) per edit (a fresh full-string allocation each time) and
  // turns into N×file-size memory churn on monolithic source.
  const sorted = [...edits].sort((a, b) => a.start - b.start)
  const text = sf.getFullText()
  const chunks: string[] = []
  let pos = 0
  for (const e of sorted) {
    // Defensive: edits should be non-overlapping. If they aren't, drop the
    // overlapping one rather than corrupting the file.
    if (e.start < pos) continue
    if (e.start > pos) chunks.push(text.slice(pos, e.start))
    chunks.push(e.replacement)
    pos = e.end
  }
  if (pos < text.length) chunks.push(text.slice(pos))
  sf.replaceWithText(chunks.join(''))
}

function transformSourceFile(
  sf: import('ts-morph').SourceFile,
  fnBucket: Map<string, ResolvedFunction> | undefined,
  modelBucket: Map<string, ResolvedModel> | undefined,
  isSchemaFile: boolean,
  ctx: TransformContext
): TransformResult {
  let transformed = 0
  let skipped = 0
  const usedBuilders = new Set<string>()
  const replacedZqNames = new Set<string>()
  // Track `*Fields` records this endpoint file references via Phase-2 sharing.
  // Each entry is the record name; we look up the source file via modelInfos
  // (passed in via ctx) to compute the relative import path.
  const usedRecordsInFile = new Set<string>()
  let needConvexValues = false
  let needDefineTable = false
  let needDefineSchema = false

  // Bulk-edit buffer: every per-call-site rewrite pushes (start, end, text)
  // tuples here instead of mutating ts-morph nodes one at a time. We apply
  // them all in one replaceWithText after collection.
  const edits: TextEdit[] = []
  // Records to inject at the top of the file post-edit (defineZodModel
  // shape models without a pre-existing `*Fields` declaration). The seed
  // monolithic source always has them inline so this is rare in practice.
  const recordsToInject: { name: string; source: string }[] = []

  // Model compile: defineZodModel('name', shape, opts?).index(...).index(...)
  if (modelBucket) {
    for (const stmt of sf.getStatements()) {
      if (!stmt.getKindName().includes('VariableStatement')) continue
      const varStmt = stmt as import('ts-morph').VariableStatement
      if (!varStmt.hasExportKeyword()) continue
      for (const decl of varStmt.getDeclarations()) {
        if (collectDefineZodModelEdits(decl, sf, modelBucket, edits, recordsToInject)) {
          transformed++
          needConvexValues = true
          needDefineTable = true
        }
      }
    }
  }

  // Endpoint compile: zq({...}) / zm({...}) / za({...}) etc.
  if (fnBucket) {
    for (const stmt of sf.getStatements()) {
      if (!stmt.getKindName().includes('VariableStatement')) continue
      const varStmt = stmt as import('ts-morph').VariableStatement
      if (!varStmt.hasExportKeyword()) continue
      for (const decl of varStmt.getDeclarations()) {
        const init = decl.getInitializer()
        if (!init || !isCallExpression(init)) continue
        const call = init as import('ts-morph').CallExpression
        const callee = call.getExpression()
        if (!isIdentifier(callee)) continue
        const calleeName = callee.getText()
        if (!ZQ_NAMES.includes(calleeName as any)) continue

        const exportName = decl.getName()
        const fn = fnBucket.get(exportName)
        if (!fn || (!fn.argsSource && !fn.returnsSource)) {
          if (ctx.verbose) {
            console.log(
              `  [skip] ${path.basename(sf.getFilePath())}:${exportName} — no resolvable args/returns`
            )
          }
          skipped++
          continue
        }

        const arg = call.getArguments()[0]
        if (!arg || !isObjectLiteral(arg)) {
          skipped++
          continue
        }
        const obj = arg as import('ts-morph').ObjectLiteralExpression

        if (fn.argsSource) {
          const argsProp = obj.getProperty('args')
          if (argsProp && isPropertyAssignment(argsProp)) {
            const init = (argsProp as import('ts-morph').PropertyAssignment).getInitializer()
            if (init) {
              edits.push({ start: init.getStart(), end: init.getEnd(), replacement: fn.argsSource })
            }
          } else if (!argsProp) {
            // Insert at the start of the object literal — `{` is at obj.getStart(),
            // we drop a `args: <source>,` right after.
            edits.push({
              start: obj.getStart() + 1,
              end: obj.getStart() + 1,
              replacement: ` args: ${fn.argsSource},`
            })
          }
        }
        if (fn.returnsSource) {
          const returnsProp = obj.getProperty('returns')
          if (returnsProp && isPropertyAssignment(returnsProp)) {
            const init = (returnsProp as import('ts-morph').PropertyAssignment).getInitializer()
            if (init) {
              edits.push({ start: init.getStart(), end: init.getEnd(), replacement: fn.returnsSource })
            }
          }
        }

        const newName = ZQ_TO_BUILDER[calleeName as keyof typeof ZQ_TO_BUILDER]
        edits.push({ start: callee.getStart(), end: callee.getEnd(), replacement: newName })
        replacedZqNames.add(calleeName)
        usedBuilders.add(newName)
        needConvexValues = true
        for (const r of fn.usedRecords) usedRecordsInFile.add(r)
        transformed++
      }
    }
  }

  // Schema compile: defineZodSchema(...) → defineSchema(...). Just a callee
  // rename — collected as one text edit per call (typically one per file).
  if (isSchemaFile) {
    const schemaEdits = collectDefineZodSchemaEdits(sf)
    if (schemaEdits.length > 0) {
      edits.push(...schemaEdits)
      transformed += schemaEdits.length
      needDefineSchema = true
    }
  }

  if (transformed === 0) {
    return { transformed: 0, skipped }
  }

  const tApply = Date.now()
  applyTextEdits(sf, edits)
  if (ctx.verbose) console.log(`  [perf]     applyTextEdits: ${((Date.now() - tApply) / 1000).toFixed(2)}s, ${edits.length} edits`)
  for (const r of recordsToInject) {
    sf.insertVariableStatement(0, {
      isExported: true,
      declarations: [{ name: r.name, initializer: r.source }]
    })
  }

  const tImports = Date.now()
  rewriteImports(sf, {
    replacedZqNames,
    usedBuilders,
    needConvexValues,
    needDefineTable,
    needDefineSchema,
    convexDir: ctx.convexDir,
    usedRecordsInFile,
    recordSources: ctx.recordSources
  })

  if (ctx.verbose) console.log(`  [perf]     rewriteImports: ${((Date.now() - tImports) / 1000).toFixed(2)}s`)

  // Drop unused imports + unused local variable declarations to keep the
  // push-time module graph thin (the whole point of compile-away).
  const tPrune = Date.now()
  pruneUnusedSymbols(sf)
  if (ctx.verbose) console.log(`  [perf]     pruneUnusedSymbols: ${((Date.now() - tPrune) / 1000).toFixed(2)}s`)

  return { transformed, skipped }
}

/**
 * Phase 1.5 + 2 model transform — collects edits for the bulk-apply pass.
 *
 *   1. Replace the inner `defineZodModel(...)` call with `defineTable(...)`,
 *      keeping any chained `.index(...)`. Pushed as a TextEdit covering the
 *      root call expression's source range.
 *   2. For shape models: ensure an `export const <fieldsRecordName> = {...}`
 *      exists. If one's already in source (the common monolithic case),
 *      rewrite its initializer via TextEdit. If not, queue a structural
 *      insert via `recordsToInject` (rare; applied by ts-morph after the
 *      bulk text rewrite).
 *
 * Returns true if any edit was queued.
 */
function collectDefineZodModelEdits(
  decl: import('ts-morph').VariableDeclaration,
  sf: import('ts-morph').SourceFile,
  modelBucket: Map<string, ResolvedModel>,
  edits: TextEdit[],
  recordsToInject: { name: string; source: string }[]
): boolean {
  const exportName = decl.getName()
  const resolved = modelBucket.get(exportName)
  if (!resolved) return false

  const init = decl.getInitializer()
  if (!init) return false
  const root = findRootCall(init)
  if (!root) return false
  const callee = root.getExpression()
  if (!isIdentifier(callee) || callee.getText() !== 'defineZodModel') return false

  if (resolved.kind === 'shape') {
    const fieldsSource = convexArgsToSource(resolved.convexFields)
    queueFieldsRecordEdit(sf, resolved.fieldsRecordName, fieldsSource, edits, recordsToInject)
    edits.push({
      start: root.getStart(),
      end: root.getEnd(),
      replacement: `defineTable(${resolved.fieldsRecordName})`
    })
    return true
  }
  // union: emit the v.* literal inline.
  edits.push({
    start: root.getStart(),
    end: root.getEnd(),
    replacement: `defineTable(${resolved.validatorSource})`
  })
  return true
}

/**
 * Queues the right edit to ensure `export const <fieldsRecordName> = { ... }`
 * exists in the file with the given initializer source.
 *
 * - Already declared (common monolithic case): TextEdit replacing its
 *   existing initializer + ensuring `export`.
 * - Not declared: pushed onto `recordsToInject` so ts-morph inserts a new
 *   statement after the bulk text rewrite (positions stable).
 */
function queueFieldsRecordEdit(
  sf: import('ts-morph').SourceFile,
  fieldsRecordName: string,
  fieldsSource: string,
  edits: TextEdit[],
  recordsToInject: { name: string; source: string }[]
): void {
  for (const stmt of sf.getVariableStatements()) {
    for (const d of stmt.getDeclarations()) {
      if (d.getName() !== fieldsRecordName) continue
      const existingInit = d.getInitializer()
      if (existingInit) {
        edits.push({
          start: existingInit.getStart(),
          end: existingInit.getEnd(),
          replacement: fieldsSource
        })
      }
      // If the const isn't currently exported, prepend `export ` to its
      // statement. The statement's leading-whitespace offset is `getStart()`
      // before the leading trivia, so use `getStart(true)` semantics: prepend
      // at the statement's actual start.
      if (!stmt.hasExportKeyword()) {
        edits.push({
          start: stmt.getStart(),
          end: stmt.getStart(),
          replacement: 'export '
        })
      }
      return
    }
  }
  // Not declared yet; structural insert handled post-text-edit.
  recordsToInject.push({ name: fieldsRecordName, source: fieldsSource })
}

/**
 * Replaces `defineZodSchema(<obj>)` with `defineSchema(<obj>)`. Returns true
 * if changed. Args are passed through verbatim — they're already a record of
 * model exports, which after model-file compile are vanilla `defineTable(...)`
 * results.
 */
function collectDefineZodSchemaEdits(sf: import('ts-morph').SourceFile): TextEdit[] {
  const out: TextEdit[] = []
  sf.forEachDescendant(node => {
    if (!isCallExpression(node)) return
    const call = node as import('ts-morph').CallExpression
    const callee = call.getExpression()
    if (!isIdentifier(callee)) return
    if (callee.getText() !== 'defineZodSchema') return
    out.push({ start: callee.getStart(), end: callee.getEnd(), replacement: 'defineSchema' })
  })
  return out
}


/** Walks down `expr.x().y().z()` style chains to the root CallExpression. */
function findRootCall(
  node: import('ts-morph').Node
): import('ts-morph').CallExpression | undefined {
  let cur: import('ts-morph').Node | undefined = node
  while (cur) {
    if (isCallExpression(cur)) {
      const expr = (cur as import('ts-morph').CallExpression).getExpression()
      // CallExpression on PropertyAccessExpression? walk further into the LHS.
      if (expr.getKindName() === 'PropertyAccessExpression') {
        cur = (expr as import('ts-morph').PropertyAccessExpression).getExpression()
        continue
      }
      return cur as import('ts-morph').CallExpression
    }
    return undefined
  }
  return undefined
}

function rewriteImports(
  sf: import('ts-morph').SourceFile,
  opts: {
    replacedZqNames: Set<string>
    usedBuilders: Set<string>
    needConvexValues: boolean
    needDefineTable: boolean
    needDefineSchema: boolean
    convexDir: string
    /** *Fields records this file references (Phase-2 sharing). */
    usedRecordsInFile: Set<string>
    /** fieldsRecordName → source file (relative to convexDir). */
    recordSources: Map<string, string>
  }
): void {
  // Drop replaced zq names from their import declarations. We don't reuse the
  // import path because the user's functions.ts typically re-exports
  // `zq`/`zm`/`za` (from initZodvex) but not raw `query`/`mutation`/`action`.
  // We always source the raw builders directly from `_generated/server`.
  for (const imp of sf.getImportDeclarations()) {
    const named = imp.getNamedImports()
    for (const m of named.filter(n => opts.replacedZqNames.has(n.getName()))) {
      m.remove()
    }
  }

  if (opts.usedBuilders.size > 0) {
    const builderModule = computeGeneratedServerSpecifier(sf, opts.convexDir)
    upsertNamedImports(sf, builderModule, [...opts.usedBuilders])
  }
  if (opts.needConvexValues) {
    upsertNamedImports(sf, 'convex/values', ['v'])
  }
  // `defineTable` and `defineSchema` both come from `convex/server`. The user
  // may already import other things from there — upsert dedupes.
  const convexServerNeeded: string[] = []
  if (opts.needDefineTable) convexServerNeeded.push('defineTable')
  if (opts.needDefineSchema) convexServerNeeded.push('defineSchema')
  if (convexServerNeeded.length > 0) {
    upsertNamedImports(sf, 'convex/server', convexServerNeeded)
  }

  // Phase 2: inject `*Fields` imports for any record this file references.
  // Group by source file so multiple records from the same model file share
  // a single import declaration.
  if (opts.usedRecordsInFile.size > 0) {
    const grouped = new Map<string, string[]>()
    for (const recordName of opts.usedRecordsInFile) {
      const sourceFile = opts.recordSources.get(recordName)
      if (!sourceFile) continue
      const fileDir = path.dirname(sf.getFilePath())
      const targetAbs = path.join(opts.convexDir, sourceFile)
      let rel = path.relative(fileDir, targetAbs).replace(/\.tsx?$/, '')
      if (!rel.startsWith('.')) rel = `./${rel}`
      const spec = rel.split(path.sep).join('/')
      // Skip self-imports — a model file references its own *Fields directly.
      if (path.resolve(targetAbs) === path.resolve(sf.getFilePath())) continue
      const arr = grouped.get(spec) ?? []
      arr.push(recordName)
      grouped.set(spec, arr)
    }
    for (const [spec, names] of grouped) {
      upsertNamedImports(sf, spec, names)
    }
  }
}

/**
 * Resolves the relative path from this source file to `_generated/server` by
 * walking up from `convexDir`. Convex generates `_generated/` at the project's
 * convex root; if the user passed a sub-directory (e.g. the stress-test's
 * `convex/composed/`), we still need to point at the real server module one
 * (or more) levels up.
 */
function computeGeneratedServerSpecifier(
  sf: import('ts-morph').SourceFile,
  convexDir: string
): string {
  const fileDir = path.dirname(sf.getFilePath())
  const generatedDir = findGeneratedServerDir(convexDir)
  const target = path.join(generatedDir, '_generated', 'server')
  let rel = path.relative(fileDir, target)
  if (!rel.startsWith('.')) rel = `./${rel}`
  return rel.split(path.sep).join('/')
}

function findGeneratedServerDir(convexDir: string): string {
  let cur = convexDir
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(cur, '_generated')
    if (
      fs.existsSync(path.join(candidate, 'server.ts')) ||
      fs.existsSync(path.join(candidate, 'server.js'))
    ) {
      return cur
    }
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  // Fallback: assume `_generated/` lives directly inside convexDir. The user
  // can always run `convex codegen` to populate it.
  return convexDir
}

function upsertNamedImports(
  sf: import('ts-morph').SourceFile,
  moduleSpecifier: string,
  names: string[]
): void {
  if (names.length === 0) return
  let existing = sf
    .getImportDeclarations()
    .find(d => d.getModuleSpecifierValue() === moduleSpecifier)

  if (!existing) {
    sf.addImportDeclaration({
      moduleSpecifier,
      namedImports: names.map(name => ({ name }))
    })
    return
  }

  const have = new Set(existing.getNamedImports().map(n => n.getName()))
  const toAdd = names.filter(n => !have.has(n))
  if (toAdd.length > 0) {
    existing.addNamedImports(toAdd.map(name => ({ name })))
  }
}

/**
 * Removes import specifiers and top-level `const` declarations whose names are
 * no longer referenced anywhere in the file. Runs iteratively because dropping
 * a const can free up its imports too.
 */
function pruneUnusedSymbols(sf: import('ts-morph').SourceFile): void {
  // Up to 4 cascade passes — dropping a const can free its imports, and
  // dropping imports can free more consts. Each pass is:
  //   1. one O(file size) forEachDescendant to build the usage map
  //   2. O(decls) map lookups + collection of deletion ranges
  //   3. one applyTextEdits to remove all dropped declarations at once
  //
  // ts-morph's per-node `.remove()` reparses the surrounding file every
  // time — with thousands of unused consts on a monolithic source that's
  // O(N²). Bulk text deletion drops it to O(N) per pass.
  for (let pass = 0; pass < 4; pass++) {
    const usage = buildFileUsageMap(sf)
    const deletions: TextEdit[] = []
    const importRewrites: TextEdit[] = []
    const text = sf.getFullText()

    // Imports: rebuild each ImportDeclaration to drop unused specifiers.
    for (const imp of sf.getImportDeclarations()) {
      const namedImports = imp.getNamedImports()
      const usedNamed = namedImports.filter(n => isReferencedInFile(n.getName(), usage))
      const defaultImport = imp.getDefaultImport()
      const namespaceImport = imp.getNamespaceImport()
      const allUsedNamed = usedNamed.length === namedImports.length
      if (allUsedNamed) continue
      const moduleSpec = imp.getModuleSpecifierValue() ?? ''
      const isTypeOnly = imp.isTypeOnly()

      // No default / namespace / specifiers left → drop the whole import.
      if (
        usedNamed.length === 0 &&
        !defaultImport &&
        !namespaceImport
      ) {
        let end = imp.getEnd()
        if (text[end] === '\n') end++
        deletions.push({ start: imp.getStart(), end, replacement: '' })
        continue
      }

      // Rebuild keeping default / namespace + retained named specifiers.
      const parts: string[] = []
      if (defaultImport) parts.push(defaultImport.getText())
      if (namespaceImport) parts.push(`* as ${namespaceImport.getText()}`)
      if (usedNamed.length > 0) {
        parts.push(`{ ${usedNamed.map(n => n.getText()).join(', ')} }`)
      }
      const prefix = isTypeOnly ? 'import type ' : 'import '
      importRewrites.push({
        start: imp.getStart(),
        end: imp.getEnd(),
        replacement: `${prefix}${parts.join(', ')} from ${JSON.stringify(moduleSpec)}`
      })
    }

    // Top-level non-export const statements: drop those whose only declared
    // names are unreferenced. (Exports are handled by the project-wide pass.)
    for (const stmt of sf.getVariableStatements()) {
      if (stmt.hasExportKeyword()) continue
      const decls = stmt.getDeclarations()
      const allUnused = decls.every(d => !isReferencedInFile(d.getName(), usage))
      if (!allUnused) continue
      let end = stmt.getEnd()
      if (text[end] === '\n') end++
      deletions.push({ start: stmt.getStart(), end, replacement: '' })
    }

    const all = [...deletions, ...importRewrites]
    if (all.length === 0) break
    applyTextEdits(sf, all)
  }
}

function isIdentifierReferenced(
  sf: import('ts-morph').SourceFile,
  name: string,
  exclude: import('ts-morph').Node
): boolean {
  // Walk all Identifier descendants. Compare text, exclude the declaration itself.
  let found = false
  sf.forEachDescendant(node => {
    if (found) return
    if (node === exclude) return
    if (!isIdentifier(node)) return
    if (node.getText() !== name) return
    // Skip identifiers that are themselves part of the exclude declaration's
    // name-binding subtree (covers `const X = ...` where the LHS Identifier is
    // a child of the VariableDeclaration we're checking).
    if (isInsideExcluded(node, exclude)) return
    found = true
  })
  return found
}

function isInsideExcluded(
  node: import('ts-morph').Node,
  exclude: import('ts-morph').Node
): boolean {
  let cur: import('ts-morph').Node | undefined = node
  while (cur) {
    if (cur === exclude) return true
    cur = cur.getParent()
  }
  return false
}

// --- ts-morph kind helpers (avoid re-importing SyntaxKind everywhere) ---

function isCallExpression(node: import('ts-morph').Node): boolean {
  return node.getKindName() === 'CallExpression'
}
function isIdentifier(node: import('ts-morph').Node): boolean {
  return node.getKindName() === 'Identifier'
}
function isObjectLiteral(node: import('ts-morph').Node): boolean {
  return node.getKindName() === 'ObjectLiteralExpression'
}
function isPropertyAssignment(node: import('ts-morph').Node): boolean {
  return node.getKindName() === 'PropertyAssignment'
}

// --- exported for testing ---
export { convexArgsToSource, convexValidatorToSource }
