import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'fs'
import { join, basename } from 'path'
import { fileURLToPath } from 'url'

const EXAMPLE_DIR = fileURLToPath(new URL('.', import.meta.url))
const SEEDS_DIR = join(EXAMPLE_DIR, 'seeds')

export type Flavor = 'zodvex' | 'convex' | 'convex-helpers' | 'convex-helpers-zod3'

export interface ComposeConfig {
  count: number
  outputDir: string
  flavor?: Flavor
  /**
   * For the zodvex flavor: emit a `functions.ts` that mirrors the real-world
   * codegen-using pattern (statically imports `./_zodvex/api.js` and passes
   * the registry to `initZodvex`). The runner is responsible for invoking
   * `zodvex generate` against the output dir before measurement.
   */
  withCodegen?: boolean
  /**
   * For the zodvex flavor: bake `{ schemaHelpers: false }` into the emitted
   * `defineZodModel` calls so the real Convex schema-eval sandbox sees a
   * static value. (Reading `process.env.ZODVEX_SLIM` at module top level
   * throws in Convex — env access is not allowed during schema eval.)
   */
  slim?: boolean
}

interface FlavorSpec {
  // Pascal-suffixed identifiers on each seed that get renamed (e.g. 'Model' or 'Table'+'Doc')
  pascalSuffixes: string[]
  // How to find a seed's table name. Searches model source, then endpoint source.
  findTableName(modelSource: string, endpointSource: string, fallback: string): string
  /** The flat list of identifiers each model emits, given the renamed pascal+camel pair.
   *  Used to build the `import { ... } from './schema'` block in endpoints.ts. */
  modelExports(pascal: string, camel: string): string[]
  /** Returns the schema-level imports + the schema-construction call.
   *  Model body declarations get spliced between them by the monolithic emitter. */
  buildSchemaParts(entries: Array<{ table: string; fileName: string; pascal: string }>): { imports: string; schemaCall: string }
  // Builds functions.ts — returns null to skip
  buildFunctions(opts?: { withCodegen?: boolean }): string | null
}

function camelOf(pascal: string): string {
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

const FLAVORS: Record<Flavor, FlavorSpec> = {
  zodvex: {
    pascalSuffixes: ['Model'],
    findTableName(modelSource, _endpointSource, fallback) {
      const m = modelSource.match(/defineZodModel\(\s*'([^']+)'/)
      return m ? m[1] : fallback
    },
    modelExports(pascal, camel) {
      return [`${pascal}Model`, `${camel}Fields`]
    },
    buildSchemaParts(entries) {
      const tables = entries.map(e => `  ${e.table}: ${e.pascal}Model,`).join('\n')
      return {
        imports: `import { z } from 'zod'
import { defineZodModel, zx } from 'zodvex'
import { defineZodSchema } from 'zodvex/server'`,
        schemaCall: `export default defineZodSchema({
${tables}
})
`
      }
    },
    buildFunctions(opts) {
      if (opts?.withCodegen) {
        return `import { initZodvex } from 'zodvex/server'
import {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction,
} from './_generated/server'
import schema from './schema'

export const { zq, zm, za, ziq, zim, zia } = initZodvex(schema, {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction,
}, {
  registry: async () => (await import('./_zodvex/api.js')).zodvexRegistry,
})
`
      }
      return `import { initZodvex } from 'zodvex/server'
import {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction,
} from './_generated/server'

const schema = { __zodTableMap: {} } as any

export const { zq, zm } = initZodvex(schema, {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction,
}, { wrapDb: false })
`
    },
  },
  convex: {
    pascalSuffixes: ['Table', 'Doc'],
    findTableName(modelSource, endpointSource, fallback) {
      const m = endpointSource.match(/v\.id\(\s*'([^']+)'\s*\)/)
      return m ? m[1] : fallback
    },
    modelExports(pascal, camel) {
      return [`${pascal}Table`, `${pascal}Doc`, `${camel}Fields`]
    },
    buildSchemaParts(entries) {
      const tables = entries.map(e => `  ${e.table}: ${e.pascal}Table,`).join('\n')
      return {
        imports: `import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'`,
        schemaCall: `export default defineSchema({
${tables}
})
`
      }
    },
    buildFunctions() {
      return `export { query, mutation, action, internalQuery, internalMutation, internalAction } from './_generated/server'
`
    },
  },
  'convex-helpers': {
    pascalSuffixes: ['Table'],
    findTableName(_modelSource, endpointSource, fallback) {
      const m = endpointSource.match(/zid\(\s*'([^']+)'\s*\)/)
      return m ? m[1] : fallback
    },
    modelExports(pascal, camel) {
      return [`${pascal}Table`, `${camel}Fields`]
    },
    buildSchemaParts(entries) {
      const tables = entries.map(e => `  ${e.table}: ${e.pascal}Table,`).join('\n')
      return {
        imports: `import { z } from 'zod'
import { defineSchema, defineTable } from 'convex/server'
import { zid, zodToConvex, zodToConvexFields } from 'convex-helpers/server/zod4'`,
        schemaCall: `export default defineSchema({
${tables}
})
`
      }
    },
    buildFunctions() {
      return `import { zCustomQuery, zCustomMutation, zCustomAction } from 'convex-helpers/server/zod4'
import { NoOp } from 'convex-helpers/server/customFunctions'
import {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction,
} from './_generated/server'

export const zQuery = zCustomQuery(query, NoOp)
export const zMutation = zCustomMutation(mutation, NoOp)
export const zAction = zCustomAction(action, NoOp)
export const zInternalQuery = zCustomQuery(internalQuery, NoOp)
export const zInternalMutation = zCustomMutation(internalMutation, NoOp)
export const zInternalAction = zCustomAction(internalAction, NoOp)
`
    },
  },
  'convex-helpers-zod3': {
    pascalSuffixes: ['Table'],
    findTableName(_modelSource, endpointSource, fallback) {
      const m = endpointSource.match(/zid\(\s*'([^']+)'\s*\)/)
      return m ? m[1] : fallback
    },
    modelExports(pascal, camel) {
      return [`${pascal}Table`, `${camel}Fields`]
    },
    buildSchemaParts(entries) {
      const tables = entries.map(e => `  ${e.table}: ${e.pascal}Table,`).join('\n')
      return {
        imports: `import { z } from 'zod/v3'
import { defineSchema, defineTable } from 'convex/server'
import { zid, zodToConvex, zodToConvexFields } from 'convex-helpers/server/zod3'`,
        schemaCall: `export default defineSchema({
${tables}
})
`
      }
    },
    buildFunctions() {
      return `import { zCustomQuery, zCustomMutation, zCustomAction } from 'convex-helpers/server/zod3'
import { NoOp } from 'convex-helpers/server/customFunctions'
import {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction,
} from './_generated/server'

export const zQuery = zCustomQuery(query, NoOp)
export const zMutation = zCustomMutation(mutation, NoOp)
export const zAction = zCustomAction(action, NoOp)
export const zInternalQuery = zCustomQuery(internalQuery, NoOp)
export const zInternalMutation = zCustomMutation(internalMutation, NoOp)
export const zInternalAction = zCustomAction(internalAction, NoOp)
`
    },
  },
}

interface SeedInfo {
  name: string
  pascal: string
  modelSource: string
  endpointSource: string
  tableName: string
  fieldsExport: string
}

function toPascal(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function loadSeeds(flavor: Flavor): SeedInfo[] {
  const spec = FLAVORS[flavor]
  const flavorDir = join(SEEDS_DIR, flavor)
  const modelDir = join(flavorDir, 'models')
  const endpointDir = join(flavorDir, 'endpoints')
  if (!existsSync(modelDir)) {
    throw new Error(`Seeds not found for flavor '${flavor}': ${modelDir}`)
  }
  const seeds: SeedInfo[] = []

  for (const file of readdirSync(modelDir).filter(f => f.endsWith('.ts')).sort()) {
    const name = basename(file, '.ts')
    const pascal = toPascal(name)
    const modelSource = readFileSync(join(modelDir, file), 'utf-8')
    const endpointPath = join(endpointDir, file)
    const endpointSource = existsSync(endpointPath) ? readFileSync(endpointPath, 'utf-8') : ''

    const tableName = spec.findTableName(modelSource, endpointSource, name + 's')
    const fieldsExport = `${name}Fields`

    seeds.push({ name, pascal, modelSource, endpointSource, tableName, fieldsExport })
  }

  return seeds
}

function renameSeed(
  source: string,
  seed: SeedInfo,
  suffix: string,
  newTable: string,
  newPascal: string,
  spec: FlavorSpec,
  opts?: { slim?: boolean }
): string {
  let out = source
  out = out.replaceAll(`'${seed.tableName}'`, `'${newTable}'`)
  for (const s of spec.pascalSuffixes) {
    out = out.replaceAll(`${seed.pascal}${s}`, `${newPascal}${s}`)
  }
  const newFields = `${newPascal.charAt(0).toLowerCase() + newPascal.slice(1)}Fields`
  out = out.replaceAll(seed.fieldsExport, newFields)
  // Bake `slim` into the source. Convex's schema-eval sandbox forbids env
  // access, and concatenated bodies would otherwise produce duplicate
  // `const opts = ...` declarations.
  const optsLiteral = opts?.slim ? '{ schemaHelpers: false } as const' : 'undefined'
  out = out.replace(/^\s*const\s+opts\s*=\s*process\.env\.ZODVEX_SLIM[^\n]*\n/m, '')
  out = out.replace(/(defineZodModel\([^)]+),\s*opts\s*\)/, `$1, ${optsLiteral})`)
  // Per-seed rename of module-level `const`s — both local (`const byIdArgs`,
  // `const addressObject`) and exported (`export const getActivity`,
  // `export const listComments`). Concatenating seed bodies into one file
  // would otherwise produce duplicate declarations: every comment seed
  // exports `getComment`, every activity seed declares `const addressObject`,
  // etc. We skip names already renamed via the pascal/fields pass — those
  // are already unique by suffix.
  const renamedModelSymbols = new Set(spec.modelExports(newPascal, camelOf(newPascal)))
  const namesToSuffix = new Set<string>()
  for (const m of out.matchAll(/^(?:export\s+)?const\s+(\w+)\s*=/gm)) {
    const name = m[1]
    if (renamedModelSymbols.has(name)) continue
    namesToSuffix.add(name)
  }
  for (const name of namesToSuffix) {
    const renamed = `${name}_${suffix}`
    out = out.replace(new RegExp(`\\b${name}\\b`, 'g'), renamed)
  }
  // Path fixups for the monolithic layout: endpoints.ts now lives at the
  // convex root next to functions.ts, not inside an endpoints/ subdir.
  out = out.replace(/from\s+(['"])\.\.\/functions\1/g, "from './functions'")
  return out
}

/**
 * Splits source into (imports, body). Imports are returned as full lines
 * (for dedup). The body has imports stripped but is otherwise untouched.
 */
function splitImports(src: string): { imports: string[]; body: string } {
  const imports: string[] = []
  const bodyLines: string[] = []
  // Single-line imports are sufficient for the seed source — none span lines.
  for (const line of src.split('\n')) {
    if (/^\s*import\s/.test(line)) imports.push(line.trim())
    else bodyLines.push(line)
  }
  return { imports, body: bodyLines.join('\n') }
}

export function compose(config: ComposeConfig): { outputDir: string } {
  const { count, outputDir } = config
  const flavor: Flavor = config.flavor ?? 'zodvex'
  const spec = FLAVORS[flavor]

  // Targeted wipe: only files compose owns. _generated/, convex.config.ts,
  // tsconfig.json, README.md, .env.local must survive.
  for (const f of [
    'schema.ts',
    'endpoints.ts',
    'functions.ts',
    'summary.json',
    '_zodvex',
    'models',
    'endpoints'
  ]) {
    const p = join(outputDir, f)
    if (existsSync(p)) rmSync(p, { recursive: true })
  }
  mkdirSync(outputDir, { recursive: true })

  const seeds = loadSeeds(flavor)
  if (seeds.length === 0) throw new Error(`No seed files found for flavor '${flavor}'`)

  const entries: Array<{ table: string; fileName: string; pascal: string }> = []
  const modelBodies: string[] = []
  const endpointBodies: string[] = []
  // Imports we'll dedupe and emit at the top of each monolithic file.
  // For schema.ts we use the spec's canonical imports — model bodies' own
  // import lines are stripped (zodvex / convex / convex-helpers all bring
  // their own from spec.buildSchemaParts).
  const endpointLibImports: string[] = []
  const allModelExportNames: string[] = []

  for (let i = 0; i < count; i++) {
    const seed = seeds[i % seeds.length]
    const suffix = String(i).padStart(4, '0')
    const newTable = `${seed.tableName}_${suffix}`
    const newPascal = `${seed.pascal}${suffix}`
    const fileName = `${seed.name}_${suffix}` // kept for summary.json compatibility

    const modelOut = renameSeed(seed.modelSource, seed, suffix, newTable, newPascal, spec, { slim: config.slim })
    modelBodies.push(splitImports(modelOut).body.trim())

    if (seed.endpointSource) {
      const endpointOut = renameSeed(seed.endpointSource, seed, suffix, newTable, newPascal, spec, { slim: config.slim })
      const { imports, body } = splitImports(endpointOut)
      endpointBodies.push(body.trim())
      // Keep only library imports (zod, zodvex, convex/values, ./functions).
      // The per-seed `from '../models/<name>'` import is replaced by a single
      // monolithic block at the top of endpoints.ts.
      for (const imp of imports) {
        if (/from\s+['"]\.\.\/models\//.test(imp)) continue
        endpointLibImports.push(imp)
      }
    }

    entries.push({ table: newTable, fileName, pascal: newPascal })
    allModelExportNames.push(...spec.modelExports(newPascal, camelOf(newPascal)))
  }

  // --- schema.ts: canonical imports + all model bodies + defineSchema call.
  const { imports: schemaImports, schemaCall } = spec.buildSchemaParts(entries)
  const schemaSource = [
    schemaImports,
    '',
    modelBodies.join('\n\n'),
    '',
    schemaCall
  ].join('\n')
  writeFileSync(join(outputDir, 'schema.ts'), schemaSource)

  // --- endpoints.ts: deduped lib imports + bulk import from ./schema + bodies.
  if (endpointBodies.length > 0) {
    const dedupLib = [...new Set(endpointLibImports)].join('\n')
    // Wrap the import list at ~6 names per line for readability.
    const exportNamesChunked: string[] = []
    const PER_LINE = 6
    for (let i = 0; i < allModelExportNames.length; i += PER_LINE) {
      exportNamesChunked.push('  ' + allModelExportNames.slice(i, i + PER_LINE).join(', ') + ',')
    }
    const schemaImport = `import {\n${exportNamesChunked.join('\n')}\n} from './schema'`
    const endpointsSource = [
      dedupLib,
      schemaImport,
      '',
      endpointBodies.join('\n\n')
    ].join('\n')
    writeFileSync(join(outputDir, 'endpoints.ts'), endpointsSource)
  }

  // --- functions.ts: unchanged (lib-level wiring, not per-seed).
  const functionsSource = spec.buildFunctions({ withCodegen: config.withCodegen })
  if (functionsSource !== null) {
    writeFileSync(join(outputDir, 'functions.ts'), functionsSource)
  }

  writeFileSync(
    join(outputDir, 'summary.json'),
    JSON.stringify({ count, flavor, withCodegen: !!config.withCodegen, seeds: seeds.length, layout: 'monolithic' }, null, 2)
  )

  return { outputDir }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const count = parseInt(args.find(a => a.startsWith('--count='))?.split('=')[1] ?? '50')
  const flavor = (args.find(a => a.startsWith('--flavor='))?.split('=')[1] ?? 'zodvex') as Flavor
  const withCodegen = args.includes('--with-codegen')
  const outputDir = args.find(a => a.startsWith('--output='))?.split('=')[1] ?? join(EXAMPLE_DIR, 'convex', 'composed')

  if (flavor !== 'zodvex' && flavor !== 'convex' && flavor !== 'convex-helpers' && flavor !== 'convex-helpers-zod3') {
    throw new Error(`Unknown --flavor=${flavor} (expected 'zodvex', 'convex', 'convex-helpers', or 'convex-helpers-zod3')`)
  }

  const flavorSeedsDir = join(SEEDS_DIR, flavor, 'models')
  console.log(
    `Composing ${count} models (flavor=${flavor}${withCodegen ? ', codegen' : ''}) from ${readdirSync(flavorSeedsDir).filter(f => f.endsWith('.ts')).length} seeds`
  )
  compose({ count, outputDir, flavor, withCodegen })
  console.log(`Output: ${outputDir}`)
}
