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
import { type DiscoveredFunction, discoverModules } from '../codegen/discover'
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
  if (discovered.functions.length === 0) {
    console.log('[zodvex compile] No zodvex functions found.')
    return { filesChanged: 0, transformedCalls: 0, skipped: 0 }
  }

  // Index functions by source file → exportName for fast lookup during AST walk.
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

  // Collect candidate files: only ones that have at least one zodvex function meta.
  const candidateFiles = [...fnIndex.keys()]

  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, target: 99 } // ESNext
  })

  let filesChanged = 0
  let transformedCalls = 0
  let skipped = 0

  for (const relFile of candidateFiles) {
    const absFile = path.resolve(convexDir, relFile)
    if (!fs.existsSync(absFile)) continue

    const sf = project.addSourceFileAtPath(absFile)
    const bucket = fnIndex.get(relFile)
    if (!bucket) continue

    const result = transformSourceFile(sf, bucket, {
      convexDir,
      verbose: options.verbose
    })

    if (result.transformed > 0) {
      filesChanged++
      transformedCalls += result.transformed
      if (options.dryRun) {
        if (options.verbose) {
          console.log(`  would change: ${relFile} (${result.transformed} call(s))`)
        }
      } else {
        sf.saveSync()
        if (options.verbose) {
          console.log(`  changed: ${relFile} (${result.transformed} call(s))`)
        }
      }
    }
    skipped += result.skipped
  }

  return { filesChanged, transformedCalls, skipped }
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
  bucket: Map<string, ResolvedFunction>,
  ctx: TransformContext
): TransformResult {
  let transformed = 0
  let skipped = 0
  const usedBuilders = new Set<string>()
  const replacedZqNames = new Set<string>()

  for (const stmt of sf.getStatements()) {
    if (!stmt.getKindName().includes('VariableStatement')) continue
    // ts-morph: VariableStatement, drill into declaration list
    const varStmt = stmt as import('ts-morph').VariableStatement
    if (!varStmt.hasExportKeyword()) continue

    for (const decl of varStmt.getDeclarations()) {
      const init = decl.getInitializer()
      if (!init) continue
      // Looking for CallExpression where callee identifier is one of zq/zm/za/...
      if (!isCallExpression(init)) continue
      const call = init as import('ts-morph').CallExpression
      const callee = call.getExpression()
      if (!isIdentifier(callee)) continue
      const calleeName = callee.getText()
      if (!ZQ_NAMES.includes(calleeName as any)) continue

      const exportName = decl.getName()
      const fn = bucket.get(exportName)
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

      // Replace args / returns initializers if we resolved them.
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

      // Swap the callee: zq → query, etc.
      const newName = ZQ_TO_BUILDER[calleeName as keyof typeof ZQ_TO_BUILDER]
      callee.replaceWithText(newName)

      replacedZqNames.add(calleeName)
      usedBuilders.add(newName)
      transformed++
    }
  }

  if (transformed === 0) {
    return { transformed: 0, skipped }
  }

  // Imports: drop replaced zq names from their import; add new builder imports
  // (sourced from the same module the zq names came from); add `v` import.
  rewriteImports(sf, {
    replacedZqNames,
    usedBuilders,
    convexDir: ctx.convexDir
  })

  // Drop unused imports + unused local variable declarations to keep the
  // push-time module graph thin (the whole point of compile-away).
  pruneUnusedSymbols(sf)

  return { transformed, skipped }
}

function rewriteImports(
  sf: import('ts-morph').SourceFile,
  opts: {
    replacedZqNames: Set<string>
    usedBuilders: Set<string>
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

  const builderModule = computeGeneratedServerSpecifier(sf, opts.convexDir)
  upsertNamedImports(sf, builderModule, [...opts.usedBuilders])
  upsertNamedImports(sf, 'convex/values', ['v'])
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
