import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { globSync } from 'tinyglobby'

/**
 * File extensions Convex bundles as entry points.
 */
const CONVEX_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.mts', '.cts']

/**
 * Discover all Convex function entry-point files in a directory.
 *
 * Applies the same filtering rules as Convex's own bundler:
 * - Excludes _generated/ and _deps/ directories
 * - Excludes schema.ts (bundled separately)
 * - Excludes dotfiles and # tempfiles
 * - Excludes files with multiple dots (e.g. foo.test.ts)
 * - Excludes files with spaces in the path
 * - Excludes subdirectories containing convex.config.ts (component boundaries)
 *
 * Returns paths relative to convexDir with forward slashes.
 */
export function discoverEntryFiles(convexDir: string): string[] {
  if (!existsSync(convexDir)) {
    throw new Error(`Convex directory does not exist: ${convexDir}`)
  }

  const extGlob = `**/*{${CONVEX_EXTENSIONS.join(',')}}`
  const candidates = globSync([extGlob], {
    cwd: convexDir,
    onlyFiles: true,
    dot: false,
    ignore: [
      '_generated/**',
      '_deps/**',
      'node_modules/**',
      '**/*.d.ts',
      'schema.ts',
      'schema.js',
      'schema.mjs',
      'schema.cjs'
    ]
  })

  const componentDirs = findComponentDirs(convexDir)

  const filtered = candidates.filter((relPath) => {
    const normalized = relPath.replace(/\\/g, '/')

    // Exclude files with spaces
    if (normalized.includes(' ')) return false

    const basename = path.basename(normalized)

    // Exclude dotfiles and emacs tempfiles
    if (basename.startsWith('.') || basename.startsWith('#')) return false

    // Exclude files with multiple dots in the basename (e.g. foo.test.ts, foo.spec.ts)
    // Matches Convex's bundler rule. The basename has exactly one dot for the extension.
    const stem = stripExtension(basename)
    if (stem.includes('.')) return false

    // Exclude anything inside a component-boundary directory
    for (const compDir of componentDirs) {
      const withSlash = compDir + '/'
      if (normalized.startsWith(withSlash)) return false
    }

    return true
  })

  return filtered.map((p) => p.replace(/\\/g, '/')).sort()
}

/**
 * Strip the last extension from a filename.
 */
function stripExtension(basename: string): string {
  const dot = basename.lastIndexOf('.')
  if (dot <= 0) return basename
  return basename.slice(0, dot)
}

/**
 * Find subdirectories that are component boundaries (contain a convex.config.ts/js).
 * These directories and their contents should be excluded from entry-point discovery.
 */
function findComponentDirs(convexDir: string): string[] {
  const matches = globSync(['**/convex.config.{ts,js}'], {
    cwd: convexDir,
    onlyFiles: true
  })

  const dirs: string[] = []
  for (const match of matches) {
    const normalized = match.replace(/\\/g, '/')
    const dir = path.posix.dirname(normalized)
    // The root convex.config.ts is not a component boundary — it is the component definition for
    // the project itself. Only subdirectory configs mark components.
    if (dir === '.' || dir === '') continue
    dirs.push(dir)
  }
  return dirs
}

/**
 * Derive the Convex module name (function-path prefix) from a relative file path.
 *
 * Examples:
 *   "tasks.ts"           -> "tasks"
 *   "api/reports.ts"     -> "api/reports"
 *   "models/task.ts"     -> "models/task"
 */
export function moduleNameFromPath(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/')
  for (const ext of CONVEX_EXTENSIONS) {
    if (normalized.endsWith(ext)) {
      return normalized.slice(0, -ext.length)
    }
  }
  return normalized
}

/**
 * Build a function path from a module name and export name.
 *
 * Examples:
 *   moduleName="tasks", exportName="list"     -> "tasks:list"
 *   moduleName="api/reports", exportName="summary" -> "api/reports:summary"
 *   moduleName="tasks", exportName="default"  -> "tasks:default"
 */
export function functionPath(moduleName: string, exportName: string): string {
  return `${moduleName}:${exportName}`
}

/**
 * Check if a path exists and is a directory.
 */
export function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}
