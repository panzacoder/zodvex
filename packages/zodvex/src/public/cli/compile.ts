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
import { convexArgsToSource, convexValidatorToSource } from './compileSerialize'

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
}

export async function runCompile(
  targetDir: string,
  options: CompileOptions = {}
): Promise<CompileResult> {
  const { Project } = await import('ts-morph')

  const convexDir = path.resolve(process.cwd(), targetDir)
  if (!fs.existsSync(convexDir)) {
    throw new Error(`Directory not found: ${convexDir}`)
  }

  console.log(
    `[zodvex compile] ${options.dryRun ? 'Dry run — ' : ''}Discovering modules in ${path.relative(process.cwd(), convexDir) || '.'}/`
  )

  const discovered = await discoverModules(convexDir)

  // Build per-file indexes so each file is touched exactly once.
  const fnIndex = new Map<string, Map<string, ResolvedFunction>>()
  for (const fn of discovered.functions) {
    const resolved = resolveFunctionToConvexSource(fn, options.verbose)
    let bucket = fnIndex.get(fn.sourceFile)
    if (!bucket) {
      bucket = new Map()
      fnIndex.set(fn.sourceFile, bucket)
    }
    bucket.set(fn.exportName, resolved)
  }

  const modelIndex = new Map<string, Map<string, ResolvedModel>>()
  for (const m of discovered.models) {
    const resolved = resolveModelToConvexSource(m, options.verbose)
    if (!resolved) continue
    let bucket = modelIndex.get(m.sourceFile)
    if (!bucket) {
      bucket = new Map()
      modelIndex.set(m.sourceFile, bucket)
    }
    bucket.set(m.exportName, resolved)
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
  for (const rel of allFiles) {
    const abs = path.resolve(convexDir, rel)
    project.addSourceFileAtPath(abs)
  }

  let filesChanged = 0
  let transformedCalls = 0
  let skipped = 0

  const transformedFiles = new Set<import('ts-morph').SourceFile>()

  for (const relFile of candidateFiles) {
    const absFile = path.resolve(convexDir, relFile)
    if (!fs.existsSync(absFile)) continue

    const sf = project.getSourceFile(absFile)
    if (!sf) continue
    const fnBucket = fnIndex.get(relFile)
    const modelBucket = modelIndex.get(relFile)
    const isSchemaFile = schemaFiles.has(relFile)

    const result = transformSourceFile(sf, fnBucket, modelBucket, isSchemaFile, {
      convexDir,
      verbose: options.verbose
    })

    if (result.transformed > 0) {
      filesChanged++
      transformedCalls += result.transformed
      transformedFiles.add(sf)
    }
    skipped += result.skipped
  }

  // Cross-file prune pass: any exported declaration in a transformed file
  // that has no remaining references project-wide can be dropped, taking its
  // imports with it. Catches `taskFields` (only ever read by endpoints, which
  // are now compiled to v.* literals) without needing per-file heuristics.
  pruneUnusedExportsAcrossProject(project, transformedFiles)

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

  return { filesChanged, transformedCalls, skipped }
}

/**
 * For every exported `const` in a transformed file, check whether any other
 * source file in the project references that identifier text. If not, drop
 * the declaration. Then re-run per-file import pruning so newly-dead imports
 * fall away. Pure text-match (not type-checker) — fast and correct enough
 * for the conservative case of "nobody uses this name anywhere else".
 */
function pruneUnusedExportsAcrossProject(
  project: import('ts-morph').Project,
  transformedFiles: Set<import('ts-morph').SourceFile>
): void {
  // Build a global identifier-text usage map across all source files except
  // each declaration's own file. Two-pass keeps it cheap.
  const referenceCounts = new Map<string, number>()
  for (const sf of project.getSourceFiles()) {
    sf.forEachDescendant(node => {
      if (!isIdentifier(node)) return
      const text = node.getText()
      referenceCounts.set(text, (referenceCounts.get(text) ?? 0) + 1)
    })
  }

  for (const sf of transformedFiles) {
    // Count this file's own usages of each name (declaration + body).
    const ownCounts = new Map<string, number>()
    sf.forEachDescendant(node => {
      if (!isIdentifier(node)) return
      const text = node.getText()
      ownCounts.set(text, (ownCounts.get(text) ?? 0) + 1)
    })

    for (const stmt of [...sf.getVariableStatements()]) {
      if (!stmt.hasExportKeyword()) continue
      for (const decl of [...stmt.getDeclarations()]) {
        const name = decl.getName()
        const total = referenceCounts.get(name) ?? 0
        const own = ownCounts.get(name) ?? 0
        // `total` counts every Identifier with this text across the project.
        // The declaration itself contributes once (the LHS Identifier). If
        // total == own, no other file references it.
        if (total <= own) {
          // Within this file too, count usages outside the declaration's
          // own subtree. If only the declaration name appears, it's dead.
          const usagesInFile = countIdentifierUsagesOutside(sf, name, decl)
          if (usagesInFile === 0) {
            decl.remove()
          }
        }
      }
    }

    // Re-run per-file prune to mop up imports that just became dead.
    pruneUnusedSymbols(sf)
  }
}

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

type ResolvedModel = {
  exportName: string
  sourceFile: string
  /** v.object({...}) source for the model's fields. */
  fieldsSource: string
}

function resolveModelToConvexSource(
  m: DiscoveredModel,
  verbose?: boolean
): ResolvedModel | undefined {
  const ref = m._modelRef as { fields?: Record<string, unknown> } | undefined
  const fields = ref?.fields
  if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
    if (verbose) {
      console.warn(
        `  [skip model] ${m.sourceFile}:${m.exportName} — no fields (likely union/discriminated)`
      )
    }
    return undefined
  }
  try {
    const convexFields = zodToConvexFields(fields as Record<string, any>)
    const fieldsSource = `v.object(${convexArgsToSource(convexFields)})`
    return { exportName: m.exportName, sourceFile: m.sourceFile, fieldsSource }
  } catch (err) {
    if (verbose) {
      console.warn(`  [skip model] ${m.sourceFile}:${m.exportName}: ${(err as Error).message}`)
    }
    return undefined
  }
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
  verbose?: boolean
): ResolvedFunction {
  let argsSource: string | undefined
  let returnsSource: string | undefined

  if (fn.zodArgs) {
    try {
      const argsObject = fn.zodArgs as unknown as InstanceType<typeof $ZodObject>
      const shape = argsObject instanceof $ZodObject ? argsObject._zod.def.shape : undefined
      if (shape) {
        const convexArgs = zodToConvexFields(shape as Record<string, any>)
        argsSource = convexArgsToSource(convexArgs)
      }
    } catch (err) {
      if (verbose) {
        console.warn(`  [skip args] ${fn.functionPath}: ${(err as Error).message}`)
      }
    }
  }

  if (fn.zodReturns) {
    try {
      const convexReturns = zodToConvex(fn.zodReturns as any)
      returnsSource = convexValidatorToSource(convexReturns)
    } catch (err) {
      if (verbose) {
        console.warn(`  [skip returns] ${fn.functionPath}: ${(err as Error).message}`)
      }
    }
  }

  return {
    exportName: fn.exportName,
    sourceFile: fn.sourceFile,
    argsSource,
    returnsSource
  }
}

type TransformContext = {
  convexDir: string
  verbose?: boolean
}

type TransformResult = {
  transformed: number
  skipped: number
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
  let needConvexValues = false
  let needDefineTable = false
  let needDefineSchema = false

  // Model compile: defineZodModel('name', shape, opts?).index(...).index(...)
  if (modelBucket) {
    for (const stmt of sf.getStatements()) {
      if (!stmt.getKindName().includes('VariableStatement')) continue
      const varStmt = stmt as import('ts-morph').VariableStatement
      if (!varStmt.hasExportKeyword()) continue
      for (const decl of varStmt.getDeclarations()) {
        if (tryTransformDefineZodModel(decl, modelBucket)) {
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
            ;(argsProp as import('ts-morph').PropertyAssignment).setInitializer(fn.argsSource)
          } else if (!argsProp) {
            obj.insertPropertyAssignment(0, {
              name: 'args',
              initializer: fn.argsSource
            })
          }
        }
        if (fn.returnsSource) {
          const returnsProp = obj.getProperty('returns')
          if (returnsProp && isPropertyAssignment(returnsProp)) {
            ;(returnsProp as import('ts-morph').PropertyAssignment).setInitializer(fn.returnsSource)
          }
        }

        const newName = ZQ_TO_BUILDER[calleeName as keyof typeof ZQ_TO_BUILDER]
        callee.replaceWithText(newName)
        replacedZqNames.add(calleeName)
        usedBuilders.add(newName)
        needConvexValues = true
        transformed++
      }
    }
  }

  // Schema compile: defineZodSchema(...) → defineSchema(...)
  if (isSchemaFile) {
    const schemaChanged = tryTransformDefineZodSchema(sf)
    if (schemaChanged) {
      transformed++
      needDefineSchema = true
    }
  }

  if (transformed === 0) {
    return { transformed: 0, skipped }
  }

  rewriteImports(sf, {
    replacedZqNames,
    usedBuilders,
    needConvexValues,
    needDefineTable,
    needDefineSchema,
    convexDir: ctx.convexDir
  })

  // Drop unused imports + unused local variable declarations to keep the
  // push-time module graph thin (the whole point of compile-away).
  pruneUnusedSymbols(sf)

  return { transformed, skipped }
}

/**
 * Replaces a `defineZodModel('name', shape, opts?)` call's *root* with
 * `defineTable(<v.object literal>)`, preserving any chained `.index(...)` /
 * `.searchIndex(...)` / `.vectorIndex(...)` calls. Returns true if changed.
 */
function tryTransformDefineZodModel(
  decl: import('ts-morph').VariableDeclaration,
  modelBucket: Map<string, ResolvedModel>
): boolean {
  const exportName = decl.getName()
  const resolved = modelBucket.get(exportName)
  if (!resolved) return false

  const init = decl.getInitializer()
  if (!init) return false
  // Walk down the chain (`.index(...)` etc.) to the root call.
  const root = findRootCall(init)
  if (!root) return false
  const callee = root.getExpression()
  if (!isIdentifier(callee) || callee.getText() !== 'defineZodModel') return false

  // Replace the entire root call with `defineTable(<fields>)`.
  const newCallText = `defineTable(${resolved.fieldsSource})`
  root.replaceWithText(newCallText)
  return true
}

/**
 * Replaces `defineZodSchema(<obj>)` with `defineSchema(<obj>)`. Returns true
 * if changed. Args are passed through verbatim — they're already a record of
 * model exports, which after model-file compile are vanilla `defineTable(...)`
 * results.
 */
function tryTransformDefineZodSchema(sf: import('ts-morph').SourceFile): boolean {
  let changed = false
  sf.forEachDescendant(node => {
    if (!isCallExpression(node)) return
    const call = node as import('ts-morph').CallExpression
    const callee = call.getExpression()
    if (!isIdentifier(callee)) return
    if (callee.getText() !== 'defineZodSchema') return
    callee.replaceWithText('defineSchema')
    changed = true
  })
  return changed
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
  for (let pass = 0; pass < 4; pass++) {
    let changed = false

    // Drop unused named imports
    for (const imp of [...sf.getImportDeclarations()]) {
      for (const named of [...imp.getNamedImports()]) {
        if (!isIdentifierReferenced(sf, named.getName(), named)) {
          named.remove()
          changed = true
        }
      }
      // If the import has no specifiers left at all, remove the whole declaration
      const stillNamed = imp.getNamedImports().length
      const hasDefault = imp.getDefaultImport() !== undefined
      const hasNamespace = imp.getNamespaceImport() !== undefined
      if (stillNamed === 0 && !hasDefault && !hasNamespace) {
        imp.remove()
        changed = true
      }
    }

    // Drop unused top-level const declarations (e.g. `const byIdArgs = {...}`)
    for (const stmt of [...sf.getVariableStatements()]) {
      if (stmt.hasExportKeyword()) continue // exported — keep
      for (const decl of [...stmt.getDeclarations()]) {
        const name = decl.getName()
        if (!isIdentifierReferenced(sf, name, decl)) {
          decl.remove()
          changed = true
        }
      }
      // If the statement now has no declarations, ts-morph drops it automatically
    }

    if (!changed) break
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
