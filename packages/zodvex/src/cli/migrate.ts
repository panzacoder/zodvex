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

/**
 * Update import specifiers: remove `zid` from zodvex imports, add `zx` if not present.
 *
 * Matches import statements like:
 *   import { zid } from 'zodvex'
 *   import { zid, zodTable } from 'zodvex'
 *   import { zid } from 'zodvex/core'
 *   import { type Zid, zid } from 'zodvex'
 */
function applyImportUpdates(content: string): string {
  // Match import { ... } from 'zodvex' or 'zodvex/...'
  const importRe = /import\s*\{([^}]+)\}\s*from\s*(['"]zodvex(?:\/[^'"]*)?['"])/g

  return content.replace(importRe, (match, specifiers: string, moduleStr: string) => {
    // Parse the specifier list
    const specs = specifiers
      .split(',')
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0)

    // Check if zid is among the specifiers (as value, not as part of "type Zid")
    const hasZid = specs.some((s: string) => s === 'zid' || s === ' zid')

    if (!hasZid) return match

    // Remove zid from specifiers
    const filtered = specs.filter((s: string) => s !== 'zid' && s !== ' zid')

    // Add zx if not already present
    const hasZx = filtered.some((s: string) => s === 'zx' || s === 'type zx' || s.endsWith(' zx'))
    if (!hasZx) {
      filtered.push('zx')
    }

    if (filtered.length === 0) {
      // All specifiers removed — replace with just zx
      return `import { zx } from ${moduleStr}`
    }

    return `import { ${filtered.join(', ')} } from ${moduleStr}`
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
