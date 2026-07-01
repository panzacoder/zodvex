import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { type AnalyzeOptions, type BuilderConfig, DEFAULT_BUILDERS } from './types'

/** Thrown for user input errors; the CLI prints the message + usage and exits 1. */
export class CliUsageError extends Error {}

export type CliOptions = {
  convexDir: string
  output?: string
  format: 'json' | 'ts'
  quiet: boolean
  configPath?: string
  tsConfigFilePath?: string
  maxDepth?: number
  builders?: Partial<BuilderConfig>
  help: boolean
  version: boolean
}

/**
 * Shape of a convex-table-graph config file (JSON or JS default export).
 * All fields optional; CLI flags take precedence over config-file values.
 */
export type ConfigFile = {
  builders?: Partial<BuilderConfig>
  maxDepth?: number
  tsConfigFilePath?: string
}

const BUILDER_KINDS = Object.keys(DEFAULT_BUILDERS) as (keyof BuilderConfig)[]

const CONFIG_FILE_NAMES = [
  'convex-table-graph.config.json',
  'convex-table-graph.config.mjs',
  'convex-table-graph.config.cjs',
  'convex-table-graph.config.js'
]

export function parseArgs(argv: string[]): CliOptions {
  const args: CliOptions = {
    convexDir: 'convex',
    format: 'json',
    quiet: false,
    help: false,
    version: false
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--dir' || a === '-d') {
      args.convexDir = requireValue(a, argv[++i])
    } else if (a === '--output' || a === '-o') {
      args.output = requireValue(a, argv[++i])
    } else if (a === '--format' || a === '-f') {
      const next = requireValue(a, argv[++i])
      if (next !== 'json' && next !== 'ts') {
        throw new CliUsageError(`Invalid --format "${next}" — expected "json" or "ts"`)
      }
      args.format = next
    } else if (a === '--config' || a === '-c') {
      args.configPath = requireValue(a, argv[++i])
    } else if (a === '--tsconfig') {
      args.tsConfigFilePath = requireValue(a, argv[++i])
    } else if (a === '--max-depth') {
      const raw = requireValue(a, argv[++i])
      const parsed = Number(raw)
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new CliUsageError(`Invalid --max-depth "${raw}" — expected a non-negative integer`)
      }
      args.maxDepth = parsed
    } else if (a === '--builder' || a === '-b') {
      const raw = requireValue(a, argv[++i])
      mergeBuilderFlag(args, raw)
    } else if (a === '--quiet' || a === '-q') {
      args.quiet = true
    } else if (a === '--help' || a === '-h') {
      args.help = true
    } else if (a === '--version' || a === '-v') {
      args.version = true
    } else if (a.startsWith('-')) {
      throw new CliUsageError(`Unknown option "${a}"`)
    } else {
      args.convexDir = a
    }
  }

  return args
}

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined) throw new CliUsageError(`Missing value for ${flag}`)
  return value
}

/**
 * Parse a repeatable `--builder kind=name,name` flag,
 * e.g. `--builder query=zq,hotpotQuery --builder mutation=zm`.
 */
function mergeBuilderFlag(args: CliOptions, raw: string): void {
  const eq = raw.indexOf('=')
  if (eq === -1) {
    throw new CliUsageError(
      `Invalid --builder "${raw}" — expected <kind>=<name>[,<name>...] (e.g. query=zq,myQuery)`
    )
  }
  const kind = raw.slice(0, eq) as keyof BuilderConfig
  if (!BUILDER_KINDS.includes(kind)) {
    throw new CliUsageError(
      `Invalid builder kind "${kind}" — expected one of: ${BUILDER_KINDS.join(', ')}`
    )
  }
  const names = raw
    .slice(eq + 1)
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
  if (names.length === 0) {
    throw new CliUsageError(`--builder "${raw}" lists no builder names`)
  }

  args.builders ??= {}
  const existing = args.builders[kind] ?? []
  args.builders[kind] = [...existing, ...names.filter((n) => !existing.includes(n))]
}

/**
 * Load a config file, either from an explicit `--config` path or by discovery.
 *
 * Discovery looks for convex-table-graph.config.{json,mjs,cjs,js} in the current
 * working directory, then in the parent of the convex/ directory (the project root).
 *
 * An explicit path that doesn't exist is an error; absence during discovery is not.
 */
export async function loadConfigFile(
  explicitPath: string | undefined,
  convexDir: string,
  cwd: string = process.cwd()
): Promise<ConfigFile | null> {
  if (explicitPath) {
    const abs = path.resolve(cwd, explicitPath)
    if (!existsSync(abs)) {
      throw new CliUsageError(`Config file not found: ${abs}`)
    }
    return readConfigFile(abs)
  }

  const searchDirs = [cwd, path.dirname(path.resolve(cwd, convexDir))]
  for (const dir of searchDirs) {
    for (const name of CONFIG_FILE_NAMES) {
      const candidate = path.join(dir, name)
      if (existsSync(candidate)) return readConfigFile(candidate)
    }
  }

  return null
}

async function readConfigFile(absPath: string): Promise<ConfigFile> {
  let loaded: unknown
  if (absPath.endsWith('.json')) {
    try {
      loaded = JSON.parse(readFileSync(absPath, 'utf8'))
    } catch (err) {
      throw new CliUsageError(`Could not parse JSON config ${absPath}: ${(err as Error).message}`)
    }
  } else {
    try {
      const mod = await import(pathToFileURL(absPath).href)
      loaded = mod.default ?? mod
    } catch (err) {
      throw new CliUsageError(`Could not load config ${absPath}: ${(err as Error).message}`)
    }
  }

  if (!loaded || typeof loaded !== 'object') {
    throw new CliUsageError(`Config ${absPath} must export an object`)
  }
  return validateConfig(loaded as Record<string, unknown>, absPath)
}

function validateConfig(raw: Record<string, unknown>, source: string): ConfigFile {
  const config: ConfigFile = {}

  if (raw.builders !== undefined) {
    if (!raw.builders || typeof raw.builders !== 'object' || Array.isArray(raw.builders)) {
      throw new CliUsageError(`Config ${source}: "builders" must be an object`)
    }
    const builders: Partial<BuilderConfig> = {}
    for (const [kind, names] of Object.entries(raw.builders)) {
      if (!BUILDER_KINDS.includes(kind as keyof BuilderConfig)) {
        throw new CliUsageError(
          `Config ${source}: unknown builder kind "${kind}" — expected one of: ${BUILDER_KINDS.join(', ')}`
        )
      }
      if (!Array.isArray(names) || names.some((n) => typeof n !== 'string')) {
        throw new CliUsageError(`Config ${source}: builders.${kind} must be an array of strings`)
      }
      builders[kind as keyof BuilderConfig] = names as string[]
    }
    config.builders = builders
  }

  if (raw.maxDepth !== undefined) {
    if (typeof raw.maxDepth !== 'number' || !Number.isInteger(raw.maxDepth) || raw.maxDepth < 0) {
      throw new CliUsageError(`Config ${source}: "maxDepth" must be a non-negative integer`)
    }
    config.maxDepth = raw.maxDepth
  }

  if (raw.tsConfigFilePath !== undefined) {
    if (typeof raw.tsConfigFilePath !== 'string') {
      throw new CliUsageError(`Config ${source}: "tsConfigFilePath" must be a string`)
    }
    // Paths in a config file are relative to the config file's location.
    config.tsConfigFilePath = path.resolve(path.dirname(source), raw.tsConfigFilePath)
  }

  return config
}

/**
 * Merge CLI flags over config-file values into the final AnalyzeOptions.
 * CLI flags win; builder lists are unioned per kind (CLI names appended).
 */
export function resolveAnalyzeOptions(cli: CliOptions, file: ConfigFile | null): AnalyzeOptions {
  const builders = mergeBuilders(file?.builders, cli.builders)
  return {
    convexDir: path.resolve(cli.convexDir),
    ...(builders ? { builders } : {}),
    ...((cli.maxDepth ?? file?.maxDepth) !== undefined
      ? { maxDepth: cli.maxDepth ?? file?.maxDepth }
      : {}),
    ...((cli.tsConfigFilePath ?? file?.tsConfigFilePath) !== undefined
      ? { tsConfigFilePath: cli.tsConfigFilePath ?? file?.tsConfigFilePath }
      : {})
  }
}

function mergeBuilders(
  base: Partial<BuilderConfig> | undefined,
  extra: Partial<BuilderConfig> | undefined
): Partial<BuilderConfig> | undefined {
  if (!base) return extra
  if (!extra) return base

  const merged: Partial<BuilderConfig> = { ...base }
  for (const [kind, names] of Object.entries(extra) as [keyof BuilderConfig, string[]][]) {
    if (!names) continue
    const existing = merged[kind] ?? []
    merged[kind] = [...existing, ...names.filter((n) => !existing.includes(n))]
  }
  return merged
}
