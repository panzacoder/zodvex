import fs from 'node:fs'
import path from 'node:path'

/**
 * Minimal tsconfig `paths` alias support for runtime discovery (#99).
 *
 * Bun resolves tsconfig path aliases natively, so `zodvex generate` under Bun
 * always worked in projects importing through aliases like `@/convex/...`.
 * Node's ESM resolver does not, so after the #93 shebang flip those imports
 * failed during discovery. This module extracts the alias mappings so the
 * discovery loader hook can retry alias-mapped candidates.
 *
 * Scope is deliberately small: JSONC-tolerant parsing, `extends` chains
 * (relative refs only), `baseUrl` + `paths`. Complex setups (package-ref
 * extends, project references) fall back to no aliases — discovery then
 * fails loudly rather than emitting a partial registry.
 */

/** One compiled alias pattern: `@/*` → prefix `@/`, suffix ``. */
export type AliasEntry = {
  prefix: string
  suffix: string
  /** Pattern contained a `*` (wildcard) vs exact match. */
  star: boolean
  /** Absolute target templates, split around their own `*`. */
  targets: Array<{ prefix: string; suffix: string }>
}

/**
 * Strips `//` and `/* *​/` comments and trailing commas so tsconfig's JSONC
 * dialect parses with JSON.parse. String-aware, so URLs in strings survive.
 */
export function stripJsonComments(input: string): string {
  let out = ''
  let inString = false
  let inLine = false
  let inBlock = false
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    const next = input[i + 1]
    if (inLine) {
      if (ch === '\n') {
        inLine = false
        out += ch
      }
      continue
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false
        i++
      }
      continue
    }
    if (inString) {
      out += ch
      if (ch === '\\') {
        out += next ?? ''
        i++
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === '/' && next === '/') {
      inLine = true
      i++
      continue
    }
    if (ch === '/' && next === '*') {
      inBlock = true
      i++
      continue
    }
    out += ch
  }
  // Trailing commas: `, }` / `, ]` (whitespace between).
  return out.replace(/,\s*([}\]])/g, '$1')
}

type TsconfigLite = {
  extends?: string | string[]
  compilerOptions?: {
    baseUrl?: string
    paths?: Record<string, string[]>
  }
}

function readTsconfig(configPath: string): TsconfigLite | null {
  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    return JSON.parse(stripJsonComments(raw)) as TsconfigLite
  } catch {
    return null
  }
}

/**
 * Resolves `paths` + `baseUrl` for one tsconfig, following relative `extends`
 * chains (child wins). Returns null when the chain declares no `paths`.
 */
function resolvePathsFromConfig(
  configPath: string,
  seen: Set<string>
): { paths: Record<string, string[]>; baseDir: string } | null {
  const abs = path.resolve(configPath)
  if (seen.has(abs)) return null
  seen.add(abs)

  const config = readTsconfig(abs)
  if (!config) return null

  const dir = path.dirname(abs)
  const own = config.compilerOptions?.paths
  if (own) {
    // Per TS: paths resolve relative to baseUrl when set, else to the config
    // file that declares them.
    const baseUrl = config.compilerOptions?.baseUrl
    return { paths: own, baseDir: baseUrl ? path.resolve(dir, baseUrl) : dir }
  }

  const parents = config.extends == null ? [] : ([] as string[]).concat(config.extends)
  for (const ref of parents) {
    // Only relative/absolute file refs; package refs (e.g. @tsconfig/node20)
    // would need full module resolution — skip them.
    if (!ref.startsWith('.') && !path.isAbsolute(ref)) continue
    let target = path.resolve(dir, ref)
    if (!target.endsWith('.json')) target += '.json'
    const found = resolvePathsFromConfig(target, seen)
    if (found) {
      // Inherited paths resolve relative to the declaring config's baseDir
      // unless the child sets its own baseUrl.
      const childBase = config.compilerOptions?.baseUrl
      return childBase ? { paths: found.paths, baseDir: path.resolve(dir, childBase) } : found
    }
  }
  return null
}

function compileAliases(paths: Record<string, string[]>, baseDir: string): AliasEntry[] {
  const entries: AliasEntry[] = []
  for (const [pattern, targets] of Object.entries(paths)) {
    const starIdx = pattern.indexOf('*')
    const star = starIdx !== -1
    const prefix = star ? pattern.slice(0, starIdx) : pattern
    const suffix = star ? pattern.slice(starIdx + 1) : ''
    const compiled = targets.map(t => {
      const tStar = t.indexOf('*')
      const tPrefix = path.resolve(baseDir, tStar === -1 ? t : t.slice(0, tStar))
      // Wildcard target prefixes like "./convex/" lose their trailing slash
      // through path.resolve — re-attach so substitution concatenates cleanly.
      const sep = tStar !== -1 && t.slice(0, tStar).endsWith('/') ? path.sep : ''
      return {
        prefix: tPrefix + sep,
        suffix: tStar === -1 ? '' : t.slice(tStar + 1)
      }
    })
    entries.push({ prefix, suffix, star, targets: compiled })
  }
  return entries
}

/**
 * Collects tsconfig path aliases visible from `convexDir`, walking up the
 * directory tree (nearest config first — its patterns take precedence).
 * Bun's resolver consults nearby tsconfigs the same way, so this restores
 * generate-under-Node parity for aliased projects.
 */
export function loadTsconfigAliases(convexDir: string): AliasEntry[] {
  const entries: AliasEntry[] = []
  const seenPatterns = new Set<string>()
  let dir = path.resolve(convexDir)
  for (let depth = 0; depth < 10; depth++) {
    const configPath = path.join(dir, 'tsconfig.json')
    if (fs.existsSync(configPath)) {
      const found = resolvePathsFromConfig(configPath, new Set())
      if (found) {
        for (const entry of compileAliases(found.paths, found.baseDir)) {
          const key = `${entry.prefix}*${entry.suffix}`
          if (!seenPatterns.has(key)) {
            seenPatterns.add(key)
            entries.push(entry)
          }
        }
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return entries
}

/** Expands a specifier against compiled aliases into absolute candidate paths. */
export function matchAlias(specifier: string, entries: AliasEntry[]): string[] {
  const candidates: string[] = []
  for (const entry of entries) {
    if (entry.star) {
      if (
        specifier.length >= entry.prefix.length + entry.suffix.length &&
        specifier.startsWith(entry.prefix) &&
        specifier.endsWith(entry.suffix)
      ) {
        const captured = specifier.slice(
          entry.prefix.length,
          specifier.length - entry.suffix.length
        )
        for (const target of entry.targets) {
          candidates.push(target.prefix + captured + target.suffix)
        }
      }
    } else if (specifier === entry.prefix) {
      for (const target of entry.targets) {
        candidates.push(target.prefix)
      }
    }
  }
  return candidates
}
