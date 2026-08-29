/**
 * zodvex migrate — automated codemod for v0.5 → v0.6 API renames.
 *
 * Walks a directory for .ts/.tsx files, applies identifier renames,
 * transforms zid() → zx.id(), updates import specifiers, and reports
 * remaining deprecated API usage that requires manual migration.
 */

import fs from 'node:fs'
import path from 'node:path'

// --- Public types ---

export type MigrateOptions = {
  dryRun: boolean
}

export type DeprecationWarning = {
  file: string
  line: number
  symbol: string
}

export type MigrateResult = {
  filesScanned: number
  filesChanged: number
  wouldChange: number
  remainingDeprecations: DeprecationWarning[]
}

// --- Constants ---

/** Directories to skip when walking the file tree. */
const SKIP_DIRS = new Set(['node_modules', '.git', '_generated', '_zodvex', 'dist'])

/** File extensions to process. */
const TS_EXTENSIONS = new Set(['.ts', '.tsx'])

/**
 * Identifier renames (applied in order via replaceAll).
 * Order matters: CodecRulesConfig MUST come before CodecRules to prevent
 * partial replacement of "CodecRulesConfig" → "ZodvexRulesConfig" being
 * eaten by a premature "CodecRules" → "ZodvexRules" match.
 */
const IDENTIFIER_RENAMES: ReadonlyArray<[string, string]> = [
  ['CodecDatabaseReader', 'ZodvexDatabaseReader'],
  ['CodecDatabaseWriter', 'ZodvexDatabaseWriter'],
  ['CodecQueryChain', 'ZodvexQueryChain'],
  ['CodecRulesConfig', 'ZodvexRulesConfig'],
  ['CodecRules', 'ZodvexRules'],
  ['createCodecCustomization', 'createZodvexCustomization'],
  ['createCodecHelpers', 'createBoundaryHelpers'],
  ['CodecHelpersOptions', 'BoundaryHelpersOptions']
]

/** Word-boundary regex for zid( — matches standalone `zid(` but not `myzid(` or `Zid`. */
const ZID_CALL_RE = /\bzid\(/g

/**
 * Deprecated symbols to scan for after migration.
 * These require manual migration and cannot be auto-renamed.
 */
const DEPRECATED_SYMBOLS = [
  'zodTable',
  'zodDoc',
  'zodDocOrNull',
  'zQueryBuilder',
  'zMutationBuilder',
  'zActionBuilder',
  'zCustomQueryBuilder',
  'zCustomMutationBuilder',
  'zCustomActionBuilder',
  'convexCodec',
  'mapDateFieldToNumber'
]

const LEGACY_IMPORTS = new Set([
  'zActionBuilder',
  'zCustomActionBuilder',
  'zCustomMutationBuilder',
  'zCustomQueryBuilder',
  'zMutationBuilder',
  'zQueryBuilder',
  'zodDoc',
  'zodDocOrNull',
  'zodTable'
])

const SERVER_IMPORTS = new Set([
  'addSystemFields',
  'createZodDbReader',
  'createZodDbWriter',
  'createZodvexActionCtx',
  'createZodvexCustomization',
  'customCtx',
  'defineZodSchema',
  'DeleteRule',
  'initZodvex',
  'InsertRule',
  'PatchRule',
  'ReadRule',
  'ReaderAuditConfig',
  'ReplaceRule',
  'TableRules',
  'WriteEvent',
  'WriterAuditConfig',
  'ZodvexActionCtx',
  'ZodvexBuilder',
  'ZodvexDatabaseReader',
  'ZodvexDatabaseWriter',
  'ZodvexExpression',
  'ZodvexExpressionOrValue',
  'ZodvexFilterBuilder',
  'ZodvexIndexFieldValue',
  'ZodvexIndexRangeBuilder',
  'ZodvexLowerBoundBuilder',
  'ZodvexMutationCtx',
  'ZodvexQueryChain',
  'ZodvexQueryCtx',
  'ZodvexRules',
  'ZodvexRulesConfig',
  'ZodvexUpperBoundBuilder',
  'zCustomAction',
  'zCustomMutation',
  'zCustomQuery'
])

type ImportGroup = 'root' | 'server' | 'legacy'

type ParsedSpecifier = {
  imported: string
  raw: string
}

// --- Core logic ---

/**
 * Recursively collect .ts/.tsx file paths, skipping excluded directories.
 */
function collectFiles(dir: string): string[] {
  const results: string[] = []

  function walk(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(path.join(current, entry.name))
        }
      } else if (entry.isFile() && TS_EXTENSIONS.has(path.extname(entry.name))) {
        results.push(path.join(current, entry.name))
      }
    }
  }

  walk(dir)
  return results
}

/**
 * Apply all identifier renames to file content using replaceAll.
 */
function applyIdentifierRenames(content: string): string {
  let result = content
  for (const [from, to] of IDENTIFIER_RENAMES) {
    result = result.replaceAll(from, to)
  }
  return result
}

/**
 * Transform `zid(` → `zx.id(` using word-boundary regex.
 */
function applyZidTransform(content: string): string {
  return content.replace(ZID_CALL_RE, 'zx.id(')
}

function parseSpecifier(specifier: string): ParsedSpecifier {
  const raw = specifier.trim()
  const withoutType = raw.startsWith('type ') ? raw.slice(5).trim() : raw
  const imported = withoutType.split(/\s+as\s+/)[0].trim()
  return { imported, raw }
}

function buildImport(modulePath: string, specifiers: string[]): string {
  return `import { ${specifiers.join(', ')} } from '${modulePath}'`
}

function classifyImport(imported: string): ImportGroup {
  if (LEGACY_IMPORTS.has(imported)) return 'legacy'
  if (SERVER_IMPORTS.has(imported)) return 'server'
  return 'root'
}

/**
 * Update import specifiers:
 * - remove `zid` from zodvex root/core imports and add `zx` if needed
 * - rewrite `zodvex/core` to `zodvex`
 * - move legacy-only symbols to `zodvex/legacy`
 * - move server-only symbols to `zodvex/server`
 *
 * Matches import statements like:
 *   import { zid } from 'zodvex'
 *   import { zid, zodTable } from 'zodvex'
 *   import { zid } from 'zodvex/core'
 *   import { type Zid, zid } from 'zodvex'
 */

/**
 * Migrates the schema.ts shape from the legacy `defineZodSchema({...models})`
 * call to the pure-Convex `defineSchema(tables)` call that pulls table
 * definitions from codegen-emitted `_zodvex/tables.ts`.
 *
 * Only rewrites files we recognise as the canonical shape — leaves anything
 * customised alone (the user will see a deprecation warning from the
 * separate scanner instead).
 *
 * Before:
 *   import { defineZodSchema } from 'zodvex/server'
 *   import { UserModel } from './models/user'
 *   import { TaskModel } from './models/task'
 *   ...
 *   export default defineZodSchema({ users: UserModel, tasks: TaskModel })
 *
 * After:
 *   import { defineSchema } from 'convex/server'
 *   import tables from './_zodvex/tables'
 *
 *   export default defineSchema(tables)
 */
function applySchemaRewrite(content: string): string {
  // Skip files that don't match the legacy shape — be permissive about
  // whitespace but anchor on the defineZodSchema call.
  if (!/\bdefineZodSchema\s*\(/.test(content)) return content
  // Whole-file match, NO /m flag: with per-line anchors any customized
  // schema.ts containing the canonical lines somewhere matched and was
  // wholesale-replaced — deleting inline models and helper exports (and,
  // since discovery no longer reads schema.ts, dropping their tables from
  // the next push). The middle section may contain ONLY import lines: any
  // other statement means the file is customized → leave it alone (the
  // deprecation scanner still warns).
  const canonicalRe =
    /^import\s+\{\s*defineZodSchema\s*\}\s+from\s+['"]zodvex(?:\/mini)?\/server['"]\s*;?\s*\n((?:\s*(?:import[^\n]*)?\n)*?)\s*export default defineZodSchema\(\{[\s\S]*?\}\)\s*;?\s*$/
  if (!canonicalRe.test(content.trim())) return content
  return [
    "import { defineSchema } from 'convex/server'",
    "import tables from './_zodvex/tables'",
    '',
    'export default defineSchema(tables)',
    ''
  ].join('\n')
}

/**
 * Migrates the functions.ts shape from the legacy initZodvex call to the
 * codegen-bundled wrapper. Drops schema/registry/tableMap imports and
 * options; rewrites the initZodvex import to come from `./_zodvex/server`.
 *
 * Recognised legacy shapes (any combination of these option fields):
 *   - registry: () => zodvexRegistry
 *   - registry: zodvexRegistry  (post-lazy form)
 *   - tableMap: zodTableMap     (post-tableMap-lazy form)
 *
 * Matches both top-level `initZodvex(schema, server, options)` calls
 * inside the destructuring assignment commonly used in functions.ts.
 */
function applyInitZodvexConsolidation(content: string): string {
  // The schema default-import may be named anything — resolve the local
  // binding of './schema' instead of assuming `schema` (an aliased import
  // used to fail this guard, leaving the file half-migrated).
  const schemaImport = content.match(
    /import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]\.\/schema(?:\.js)?['"]\s*;?\s*\n/
  )
  const schemaName = schemaImport?.[1]
  if (!schemaName) return content
  const callIdx = content.search(new RegExp(`\\binitZodvex\\(\\s*${schemaName}\\b`))
  if (callIdx === -1) return content

  // Balanced scan over the call's argument list (regexes can't handle the
  // nested braces of options like `underlyingDb: { mutation: (ctx) => … }`).
  const open = content.indexOf('(', callIdx)
  let depth = 0
  let close = -1
  for (let i = open; i < content.length; i++) {
    const c = content[i]
    if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') {
      depth--
      if (depth === 0 && c === ')') {
        close = i
        break
      }
    }
  }
  if (close === -1) return content
  const args = splitTopLevelArgs(content.slice(open + 1, close))
  if (args.length < 2) return content
  const serverArg = args[1].trim()

  // Drop only the options the generated wrapper now auto-wires; PRESERVE
  // everything else (underlyingDb, wrapDb, …) — stripping the whole object
  // silently disabled e.g. convex-helpers triggers composed under the
  // codec layer.
  let optionsArg: string | undefined = args[2]?.trim()
  if (optionsArg) {
    optionsArg = optionsArg
      .replace(/\bregistry\s*:\s*(?:\(\s*\)\s*=>\s*)?zodvexRegistry\s*,?\s*/g, '')
      .replace(/\bschedulerRegistry\s*:\s*(?:\(\s*\)\s*=>\s*)?[A-Za-z_$][\w$]*\s*,?\s*/g, '')
      .replace(/\btableMap\s*:\s*zodTableMap\s*,?\s*/g, '')
    if (/^\{[\s,]*\}$/.test(optionsArg)) optionsArg = undefined
  }

  let next =
    content.slice(0, callIdx) +
    (optionsArg ? `initZodvex(${serverArg}, ${optionsArg})` : `initZodvex(${serverArg})`) +
    content.slice(close + 1)

  // Drop the schema import only when nothing else references the binding.
  const withoutImport = next.replace(schemaImport[0], '')
  if (!new RegExp(`\\b${schemaName}\\b`).test(withoutImport)) {
    next = withoutImport
  }
  next = next.replace(
    /import\s+\{\s*zodvexRegistry\s*\}\s+from\s+['"]\.\/_zodvex\/api(?:\.lazy)?(?:\.js)?['"]\s*;?\s*\n/,
    ''
  )
  next = next.replace(
    /import\s+\{\s*zodTableMap\s*\}\s+from\s+['"]\.\/_zodvex\/tableMap\.lazy(?:\.js)?['"]\s*;?\s*\n/,
    ''
  )
  // Rewrite the initZodvex import to point at the codegen-bundled wrapper.
  next = next.replace(
    /import\s+\{\s*initZodvex\s*\}\s+from\s+['"]zodvex(?:\/mini)?\/server['"]/,
    "import { initZodvex } from './_zodvex/server'"
  )

  return next
}

/** Split a call's argument source on top-level commas (ignoring commas
 *  nested inside (), {}, []). String literals are not parsed — acceptable
 *  for the canonical functions.ts shapes this codemod targets. */
function splitTopLevelArgs(s: string): string[] {
  const args: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') depth--
    else if (c === ',' && depth === 0) {
      args.push(s.slice(start, i))
      start = i + 1
    }
  }
  args.push(s.slice(start))
  return args
}

function applyImportUpdates(content: string): string {
  const importRe = /import\s*\{([^}]+)\}\s*from\s*(['"]zodvex(?:\/[^'"]*)?['"])/g

  return content.replace(importRe, (match, specifiers: string, moduleStr: string) => {
    const modulePath = moduleStr.slice(1, -1)
    if (modulePath !== 'zodvex' && modulePath !== 'zodvex/core') {
      return match
    }

    const parsed = specifiers
      .split(',')
      .map(parseSpecifier)
      .filter((s: ParsedSpecifier) => s.raw.length > 0)

    const groups: Record<ImportGroup, string[]> = {
      root: [],
      server: [],
      legacy: []
    }

    let removedZid = false

    for (const spec of parsed) {
      if (spec.imported === 'zid') {
        removedZid = true
        continue
      }

      groups[classifyImport(spec.imported)].push(spec.raw)
    }

    if (removedZid) {
      const hasZx = groups.root.some(spec => parseSpecifier(spec).imported === 'zx')
      if (!hasZx) groups.root.push('zx')
    }

    const rewritten: string[] = []

    if (groups.root.length > 0) {
      rewritten.push(buildImport('zodvex', groups.root))
    } else if (modulePath === 'zodvex/core' && removedZid) {
      rewritten.push(buildImport('zodvex', ['zx']))
    }

    if (groups.server.length > 0) {
      rewritten.push(buildImport('zodvex/server', groups.server))
    }

    if (groups.legacy.length > 0) {
      rewritten.push(buildImport('zodvex/legacy', groups.legacy))
    }

    if (rewritten.length === 0) return ''

    return rewritten.join('\n')
  })
}

/**
 * Scan file content for remaining deprecated symbol usage.
 * Returns warnings with line numbers.
 */
function scanDeprecations(filePath: string, content: string): DeprecationWarning[] {
  const warnings: DeprecationWarning[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const symbol of DEPRECATED_SYMBOLS) {
      // Use word-boundary check to avoid false positives
      const re = new RegExp(`\\b${symbol}\\b`)
      if (re.test(line)) {
        warnings.push({
          file: filePath,
          line: i + 1, // 1-indexed
          symbol
        })
      }
    }
  }

  return warnings
}

/**
 * Migrate a directory of TypeScript files from old zodvex API names to new ones.
 *
 * @param dir - Root directory to scan
 * @param options - Migration options (dryRun: boolean)
 * @returns Migration results including file counts and deprecation warnings
 */
export function migrate(dir: string, options: MigrateOptions): MigrateResult {
  const files = collectFiles(dir)
  let filesChanged = 0
  let wouldChange = 0
  const allDeprecations: DeprecationWarning[] = []

  for (const filePath of files) {
    const original = fs.readFileSync(filePath, 'utf-8')

    // Apply transforms in sequence
    let content = original
    content = applyIdentifierRenames(content)
    content = applyZidTransform(content)
    content = applyImportUpdates(content)
    content = applySchemaRewrite(content)
    content = applyInitZodvexConsolidation(content)

    const changed = content !== original

    if (changed) {
      if (options.dryRun) {
        wouldChange++
      } else {
        fs.writeFileSync(filePath, content)
        filesChanged++
      }
    }

    // Scan for remaining deprecations (on the post-transform content)
    const contentToScan = changed ? content : original
    const deprecations = scanDeprecations(filePath, contentToScan)
    allDeprecations.push(...deprecations)
  }

  return {
    filesScanned: files.length,
    filesChanged,
    wouldChange,
    remainingDeprecations: allDeprecations
  }
}
