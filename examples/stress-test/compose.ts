// Flavor-aware composer. Takes seeds from seeds/<flavor>/{models,endpoints}/
// and fans them out into a runnable convex/ tree with a flavor-specific
// functions.ts that supplies the function builders the endpoints import.
//
// Output layout (per flavor instance):
//   <outDir>/
//     models/<seed>_NNNN.ts
//     endpoints/<seed>_NNNN.ts
//     functions.ts
//     schema.ts          (zodvex flavors only — for parity with real apps)
//
// Bundles target endpoints individually; schema.ts is not bundled here.

import { spawnSync } from 'child_process'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'fs'
import { join, basename, dirname } from 'path'
import { fileURLToPath } from 'url'
import { transformCode } from 'zod-to-mini'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SEEDS_DIR = join(__dirname, 'seeds')

export type Flavor =
  | 'zodvex'
  | 'zodvex-mini'
  | 'convex'
  | 'convex-helpers'
  | 'convex-helpers-zod3'

export interface ComposeConfig {
  flavor: Flavor
  count: number
  outputDir: string
  /**
   * Cross-table fan-in: every endpoint imports K additional models
   * (round-robin, not its own). Models them transitively into the bundle.
   * Default 0.
   */
  fanIn?: number
  /**
   * Emit a registry.ts that imports every model with side-effecting refs,
   * and add an import of it to every endpoint. Mirrors zodvex's
   * `_zodvex/api.ts` worst case where any registry consumer drags the
   * full schema graph into its bundle.
   * Default false.
   */
  registry?: boolean
  /**
   * When `registry` is on, controls how the endpoint references the registry.
   *  - 'static' (default): top-level `import { __registry } from '../registry'`
   *    pulls the entire schema graph into the endpoint's static bundle.
   *  - 'lazy': endpoint stores a `() => import('../registry')` thunk. The
   *    registry becomes a separate chunk under splitting and is not part
   *    of the entrypoint's static bundle.
   *  - 'invisible': endpoint imports nothing registry-related; the lazy
   *    thunk lives inside `functions.ts`. Models the codegen-driven case
   *    where consumers don't write any async code but the codegen output
   *    plumbs laziness for them.
   */
  registryMode?: 'static' | 'lazy' | 'invisible'
  /**
   * For zodvex / zodvex-mini flavors: emit schema.ts in the lazy-tables
   * shape (importing pre-generated `_zodvex/tables.ts` from `defineSchema`
   * instead of `defineZodSchema(models)`). Compose then invokes zodvex
   * codegen against the composed tree to populate `_zodvex/tables.ts`.
   *
   * Models the schema-only-thin pattern shipped in 19d03f8 — keeps zod
   * out of Convex's schema-eval isolate. No-op for non-zodvex flavors.
   * Default false.
   */
  lazyTables?: boolean
}

interface SeedInfo {
  name: string
  pascal: string
  modelSource: string
  endpointSource: string
  tableName: string
  modelExport: string
  fieldsExport: string
}

const toPascal = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function seedDirFor(flavor: Flavor): string {
  // 'zodvex-mini' shares zodvex seeds; the mini bit is enforced at the
  // function-builder level via different imports in functions.ts.
  if (flavor === 'zodvex-mini') return join(SEEDS_DIR, 'zodvex')
  return join(SEEDS_DIR, flavor)
}

function loadSeeds(flavor: Flavor): SeedInfo[] {
  const root = seedDirFor(flavor)
  const modelDir = join(root, 'models')
  const endpointDir = join(root, 'endpoints')
  const seeds: SeedInfo[] = []

  for (const file of readdirSync(modelDir).filter(f => f.endsWith('.ts')).sort()) {
    const name = basename(file, '.ts')
    const pascal = toPascal(name)
    const modelSource = readFileSync(join(modelDir, file), 'utf-8')
    const endpointPath = join(endpointDir, file)
    const endpointSource = existsSync(endpointPath) ? readFileSync(endpointPath, 'utf-8') : ''

    const zodvexTable = modelSource.match(/defineZodModel\(\s*'([^']+)'/)
    const convexTable = modelSource.match(/defineTable\(\s*\{[\s\S]*?\}\s*\)/) // fallback
    const tableName = zodvexTable?.[1] ?? `${name}s`

    seeds.push({
      name,
      pascal,
      modelSource,
      endpointSource,
      tableName,
      modelExport: `${pascal}Model`,
      fieldsExport: `${name}Fields`,
    })
  }

  return seeds
}

function applyFlavorImportRewrites(flavor: Flavor, source: string, filename: string): string {
  if (flavor !== 'zodvex-mini') return source
  // The zodvex-mini flavor reuses the zodvex seed corpus. The codemod
  // converts method-chain syntax (.optional(), etc.) to mini's functional
  // forms but by design does NOT rewrite imports (caller's choice). Without
  // the import rewrites the bundle contains BOTH full zod and zod/mini, so
  // mini looks heavier than full zod. Do both here.
  const { code } = transformCode(source, { filename })
  let out = code
    .replace(/from ['"]zod['"]/g, "from 'zod/mini'")
    .replace(/from ['"]zodvex['"]/g, "from 'zodvex/mini'")
  // The codemod rewrites `zx.foo().nullable()` (zodvex chain) into
  // `z.nullable(zx.foo())` even when the source never imported `z`. Inject
  // an import so the bundle resolves. No-op if z is already imported.
  if (/\bz\.[a-z]/.test(out) && !/import [^;]*\bz\b[^;]* from ['"]zod\/mini['"]/.test(out)) {
    out = `import { z } from 'zod/mini'\n${out}`
  }
  return out
}

function renameSeed(
  source: string,
  seed: SeedInfo,
  suffix: string,
  newTable: string,
  newPascal: string,
  flavor: Flavor,
): string {
  let out = applyFlavorImportRewrites(flavor, source, `${seed.name}.ts`)
  out = out.replaceAll(`'${seed.tableName}'`, `'${newTable}'`)
  out = out.replaceAll(seed.modelExport, `${newPascal}Model`)
  out = out.replaceAll(
    seed.fieldsExport,
    `${newPascal.charAt(0).toLowerCase() + newPascal.slice(1)}Fields`,
  )
  out = out.replaceAll(`../models/${seed.name}`, `../models/${seed.name}_${suffix}`)
  // Convex's schema evaluator forbids `process.env` access during module
  // init. The seed reads ZODVEX_SLIM to optionally pass `{ schemaHelpers:
  // false }`. For deployable output, inline the default (undefined).
  out = out.replace(
    /const opts = process\.env\.ZODVEX_SLIM[^\n]*\n/,
    'const opts = undefined\n',
  )
  return out
}

function invisibleRegistryPreamble(): string {
  // The dynamic import lives in a codegen-emitted wrapper file (registryApi.ts),
  // not here in functions.ts and not in any endpoint. functions.ts only
  // statically imports the small wrapper. esbuild hoists the dynamic import
  // into a chunk, so neither functions.ts nor the endpoints that depend on
  // it pull the registry's transitive graph into their static bundle.
  // The side-effecting push prevents the wrapper from being tree-shaken
  // away when the registry param isn't actually wired into initZodvex.
  return `import { loadZodvexRegistry } from './registryApi'
;((globalThis as any).__zodvexInvisibleRegistry ??= []).push(loadZodvexRegistry)
`
}

function registryApiSource(): string {
  // Codegen-emitted wrapper. Tiny — its only static dep is itself plus the
  // function it returns. The heavy registry sits in registry.ts and is
  // reached only through this dynamic import.
  return `export const loadZodvexRegistry = () =>
  import('./registry').then(m => m.__registry)
`
}

function functionsSource(flavor: Flavor, lazyRegistry: boolean): string {
  const preamble = lazyRegistry ? invisibleRegistryPreamble() : ''
  switch (flavor) {
    case 'zodvex':
      return `import { initZodvex } from 'zodvex/server'
import {
  queryGeneric as query,
  mutationGeneric as mutation,
  actionGeneric as action,
  internalQueryGeneric as internalQuery,
  internalMutationGeneric as internalMutation,
  internalActionGeneric as internalAction,
} from 'convex/server'

${preamble}const schema = { __zodTableMap: {} } as any

export const { zq, zm } = initZodvex(schema, {
  query, mutation, action, internalQuery, internalMutation, internalAction,
}, { wrapDb: false })
`
    case 'zodvex-mini':
      return `import { initZodvex } from 'zodvex/mini/server'
import {
  queryGeneric as query,
  mutationGeneric as mutation,
  actionGeneric as action,
  internalQueryGeneric as internalQuery,
  internalMutationGeneric as internalMutation,
  internalActionGeneric as internalAction,
} from 'convex/server'

${preamble}const schema = { __zodTableMap: {} } as any

export const { zq, zm } = initZodvex(schema, {
  query, mutation, action, internalQuery, internalMutation, internalAction,
}, { wrapDb: false })
`
    case 'convex':
      return `${preamble}export {
  queryGeneric as query,
  mutationGeneric as mutation,
  actionGeneric as action,
  internalQueryGeneric as internalQuery,
  internalMutationGeneric as internalMutation,
  internalActionGeneric as internalAction,
} from 'convex/server'
`
    case 'convex-helpers':
      return `import { zCustomQuery, zCustomMutation } from 'convex-helpers/server/zod4'
import { NoOp } from 'convex-helpers/server/customFunctions'
import { queryGeneric, mutationGeneric } from 'convex/server'

${preamble}export const zQuery = zCustomQuery(queryGeneric, NoOp)
export const zMutation = zCustomMutation(mutationGeneric, NoOp)
`
    case 'convex-helpers-zod3':
      return `import { zCustomQuery, zCustomMutation } from 'convex-helpers/server/zod3'
import { NoOp } from 'convex-helpers/server/customFunctions'
import { queryGeneric, mutationGeneric } from 'convex/server'

${preamble}export const zQuery = zCustomQuery(queryGeneric, NoOp)
export const zMutation = zCustomMutation(mutationGeneric, NoOp)
`
  }
}

interface TableSpec {
  fileName: string  // e.g. "task_0000"
  symbol: string    // export name in the model file (per flavor)
  alias: string     // unique import alias
  tableName: string // table key in defineSchema({...})
}

function schemaSource(flavor: Flavor, tables: TableSpec[], lazyTables: boolean): string {
  if (flavor === 'zodvex' || flavor === 'zodvex-mini') {
    const serverImport = flavor === 'zodvex-mini' ? 'zodvex/mini/server' : 'zodvex/server'
    if (lazyTables) {
      // Schema-only-thin shape: schema.ts imports the codegen-emitted
      // pure-Convex tables file. Zero zod at schema-eval. The codegen
      // step (runZodvexGenerate) populates `_zodvex/tables.ts` after
      // compose finishes; until then the file may not exist, but
      // discovery is configured to skip schema.ts.
      return `import { defineZodvexSchema } from '${serverImport}'
import tables, { type DecodedDocs } from './_zodvex/tables'

export default defineZodvexSchema<typeof tables, DecodedDocs>(tables)
`
    }
    const imports = tables.map(t => `import { ${t.symbol} as ${t.alias} } from './models/${t.fileName}'`).join('\n')
    const entries = tables.map(t => `  ${t.tableName}: ${t.alias},`).join('\n')
    return `import { defineZodSchema } from '${serverImport}'

${imports}

export default defineZodSchema({
${entries}
})
`
  }
  // Pure convex / convex-helpers / convex-helpers-zod3 all use defineSchema
  // from convex/server with defineTable values exported by each model file.
  const imports = tables.map(t => `import { ${t.symbol} as ${t.alias} } from './models/${t.fileName}'`).join('\n')
  const entries = tables.map(t => `  ${t.tableName}: ${t.alias},`).join('\n')
  return `import { defineSchema } from 'convex/server'

${imports}

export default defineSchema({
${entries}
})
`
}

export interface ComposeResult {
  flavor: Flavor
  outputDir: string
  modelsDir: string
  endpointsDir: string
  endpointFiles: string[]
}

/**
 * Pick the cross-import symbol that each flavor's model file exposes per copy.
 * zodvex flavors rename the model export to ${pascal}${suffix}Model so each
 * file has a unique symbol; convex/helpers seeds leave the base name in place
 * (TaskTable, etc.) — so cross-file references use the per-seed name.
 */
function crossImportSymbol(flavor: Flavor, seed: SeedInfo, suffix: string): string {
  if (flavor === 'zodvex' || flavor === 'zodvex-mini') return `${seed.pascal}${suffix}Model`
  return `${seed.pascal}Table`
}

interface ModelRef {
  fileName: string
  symbol: string
  /** Alias used in importing module to avoid collisions when several files share a base symbol. */
  alias: string
}

function buildFanInBlock(targets: ModelRef[]): string {
  if (targets.length === 0) return ''
  const imports = targets
    .map(t => `import { ${t.symbol} as ${t.alias} } from '../models/${t.fileName}'`)
    .join('\n')
  const refs = targets.map(t => t.alias).join(', ')
  // Side-effecting reference defeats tree-shaking. The bundle keeps the
  // imported model's transitive deps even though the endpoint never reads
  // the values at runtime.
  return `${imports}\n;((globalThis as any).__zodvexFanIn ??= []).push(${refs})\n`
}

function registrySource(flavor: Flavor, refs: ModelRef[]): string {
  // refs use unique aliases so we can re-export safely.
  const imports = refs
    .map(r => `import { ${r.symbol} as ${r.alias} } from './models/${r.fileName}'`)
    .join('\n')
  const list = refs.map(r => r.alias).join(',\n  ')
  return `${imports}

export const __registry = [
  ${list}
]
;((globalThis as any).__zodvexRegistry ??= []).push(__registry)
`
}

export function compose(config: ComposeConfig): ComposeResult {
  const {
    flavor,
    count,
    outputDir,
    fanIn = 0,
    registry = false,
    registryMode = 'static',
    lazyTables = false,
  } = config
  const modelsDir = join(outputDir, 'models')
  const endpointsDir = join(outputDir, 'endpoints')

  if (existsSync(outputDir)) rmSync(outputDir, { recursive: true })
  mkdirSync(modelsDir, { recursive: true })
  mkdirSync(endpointsDir, { recursive: true })

  const seeds = loadSeeds(flavor)
  if (seeds.length === 0) throw new Error(`No seed files found for flavor: ${flavor}`)

  if (fanIn > count - 1) {
    throw new Error(`fanIn ${fanIn} exceeds count-1 (${count - 1})`)
  }

  // First pass: write models and collect their identity (fileName + cross-import symbol).
  const allRefs: ModelRef[] = []
  const endpointPlans: { seed: SeedInfo; suffix: string; newTable: string; newPascal: string; fileName: string }[] = []

  for (let i = 0; i < count; i++) {
    const seed = seeds[i % seeds.length]
    const suffix = String(i).padStart(4, '0')
    const newTable = `${seed.tableName}_${suffix}`
    const newPascal = `${seed.pascal}${suffix}`
    const fileName = `${seed.name}_${suffix}`

    const modelOut = renameSeed(seed.modelSource, seed, suffix, newTable, newPascal, flavor)
    writeFileSync(join(modelsDir, `${fileName}.ts`), modelOut)

    allRefs.push({
      fileName,
      symbol: crossImportSymbol(flavor, seed, suffix),
      alias: `M_${i}`,
    })
    endpointPlans.push({ seed, suffix, newTable, newPascal, fileName })
  }

  if (registry) {
    writeFileSync(join(outputDir, 'registry.ts'), registrySource(flavor, allRefs))
    if (registryMode === 'invisible') {
      writeFileSync(join(outputDir, 'registryApi.ts'), registryApiSource())
    }
  }

  // Second pass: write endpoints with optional fan-in + registry imports.
  const endpointFiles: string[] = []
  const tables: TableSpec[] = []

  for (let i = 0; i < count; i++) {
    const plan = endpointPlans[i]
    const { seed, suffix, newTable, newPascal, fileName } = plan
    if (!seed.endpointSource) continue

    let endpointOut = renameSeed(seed.endpointSource, seed, suffix, newTable, newPascal, flavor)

    if (fanIn > 0) {
      // Pick fanIn other models round-robin, skipping self.
      const picks: ModelRef[] = []
      for (let k = 1; picks.length < fanIn && k < count; k++) {
        const j = (i + k) % count
        if (j === i) continue
        picks.push(allRefs[j])
      }
      endpointOut += '\n' + buildFanInBlock(picks)
    }

    if (registry) {
      if (registryMode === 'lazy') {
        // Mirrors the recommended consumer pattern from PR #60: store an
        // async thunk on the registry param. esbuild's dynamic import gets
        // hoisted into a separate chunk so the registry's transitive
        // schemas are NOT part of this endpoint's static bundle.
        endpointOut += `\nconst __registryThunk_${i} = () => import('../registry')\n;((globalThis as any).__zodvexLazyRegistry ??= []).push(__registryThunk_${i})\n`
      } else if (registryMode === 'invisible') {
        // Endpoint stays untouched. The dynamic import lives inside
        // functions.ts (added via functionsSource's `lazyRegistry` arg)
        // and esbuild hoists it into the same kind of chunk.
      } else {
        endpointOut += `\nimport { __registry as __r_${i} } from '../registry'\n;((globalThis as any).__zodvexRegistryConsumers ??= []).push(__r_${i})\n`
      }
    }

    const endpointPath = join(endpointsDir, `${fileName}.ts`)
    writeFileSync(endpointPath, endpointOut)
    endpointFiles.push(endpointPath)

    tables.push({
      fileName,
      symbol: crossImportSymbol(flavor, seed, suffix),
      alias: `T_${i}`,
      tableName: newTable,
    })
  }

  writeFileSync(
    join(outputDir, 'functions.ts'),
    functionsSource(flavor, registry && registryMode === 'invisible'),
  )
  writeFileSync(join(outputDir, 'schema.ts'), schemaSource(flavor, tables, lazyTables))
  writeFileSync(
    join(outputDir, 'summary.json'),
    JSON.stringify({ flavor, count, fanIn, registry, registryMode, lazyTables, seeds: seeds.length }, null, 2),
  )

  if (lazyTables && (flavor === 'zodvex' || flavor === 'zodvex-mini')) {
    runZodvexGenerate(outputDir, flavor === 'zodvex-mini')
  }

  return { flavor, outputDir, modelsDir, endpointsDir, endpointFiles }
}

/**
 * Invokes the zodvex CLI on the composed tree to emit `_zodvex/tables.ts`.
 * Required when lazyTables is on — schema.ts statically imports it.
 *
 * Shell-outs to bunx so we run the same code path users do. Failures here
 * propagate; the bench will then fail to bundle schema.ts and surface
 * the issue rather than producing silently-wrong measurements.
 */
function runZodvexGenerate(outputDir: string, mini: boolean): void {
  const args = ['zodvex', 'generate', outputDir]
  if (mini) args.push('--mini')
  const result = spawnSync('bunx', args, { stdio: 'pipe', encoding: 'utf-8' })
  if (result.status !== 0) {
    const detail = (result.stderr || '').trim() || (result.stdout || '').trim()
    throw new Error(`zodvex generate failed (exit ${result.status}):\n${detail}`)
  }
}

// CLI: bun run compose.ts --flavor=zodvex --count=50 [--fanin=5] [--registry] --output=...
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const flavor = (args.find(a => a.startsWith('--flavor='))?.split('=')[1] ?? 'zodvex') as Flavor
  const count = parseInt(args.find(a => a.startsWith('--count='))?.split('=')[1] ?? '50')
  const fanIn = parseInt(args.find(a => a.startsWith('--fanin='))?.split('=')[1] ?? '0')
  const registry = args.includes('--registry')
  const outputDir = args.find(a => a.startsWith('--output='))?.split('=')[1]
    ?? join(__dirname, 'convex', `composed-${flavor}`)
  const result = compose({ flavor, count, fanIn, registry, outputDir })
  console.log(`Composed ${result.endpointFiles.length} endpoint files in ${result.outputDir}` +
    (fanIn ? ` · fanIn=${fanIn}` : '') +
    (registry ? ' · registry' : ''))
}
