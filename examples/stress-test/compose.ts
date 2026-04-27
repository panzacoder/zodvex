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
}

interface FlavorSpec {
  // Pascal-suffixed identifiers on each seed that get renamed (e.g. 'Model' or 'Table'+'Doc')
  pascalSuffixes: string[]
  // How to find a seed's table name. Searches model source, then endpoint source.
  findTableName(modelSource: string, endpointSource: string, fallback: string): string
  // Builds schema.ts
  buildSchema(entries: Array<{ table: string; fileName: string; pascal: string }>): string
  // Builds functions.ts — returns null to skip
  buildFunctions(opts?: { withCodegen?: boolean }): string | null
}

const FLAVORS: Record<Flavor, FlavorSpec> = {
  zodvex: {
    pascalSuffixes: ['Model'],
    findTableName(modelSource, _endpointSource, fallback) {
      const m = modelSource.match(/defineZodModel\(\s*'([^']+)'/)
      return m ? m[1] : fallback
    },
    buildSchema(entries) {
      const imports = entries.map(e => `import { ${e.pascal}Model } from './models/${e.fileName}'`).join('\n')
      const tables = entries.map(e => `  ${e.table}: ${e.pascal}Model,`).join('\n')
      return `import { defineZodSchema } from 'zodvex/server'

${imports}

export default defineZodSchema({
${tables}
})
`
    },
    buildFunctions(opts) {
      if (opts?.withCodegen) {
        // Mirror the recommended codegen-using app pattern: dynamic-import
        // `_zodvex/api.js` so the registry's full Zod schemas stay out of
        // the push-time module graph. The registry resolves on first action
        // invocation and is cached thereafter.
        return `import { initZodvex } from 'zodvex/server'
import {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction,
} from '../_generated/server'
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
} from '../_generated/server'

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
      // Convex seeds don't carry the table name in the model file itself.
      // Look in the endpoint for the first v.id('<table>') — every endpoint has at least one.
      const m = endpointSource.match(/v\.id\(\s*'([^']+)'\s*\)/)
      return m ? m[1] : fallback
    },
    buildSchema(entries) {
      const imports = entries.map(e => `import { ${e.pascal}Table } from './models/${e.fileName}'`).join('\n')
      const tables = entries.map(e => `  ${e.table}: ${e.pascal}Table,`).join('\n')
      return `import { defineSchema } from 'convex/server'

${imports}

export default defineSchema({
${tables}
})
`
    },
    buildFunctions() {
      // Emit a proxy so endpoints (one dir below) can import via '../functions'.
      // Same trick as zodvex — endpoint files would otherwise resolve
      // '../_generated/server' to the wrong directory.
      return `export { query, mutation, action, internalQuery, internalMutation, internalAction } from '../_generated/server'
`
    },
  },
  'convex-helpers': {
    pascalSuffixes: ['Table'],
    findTableName(_modelSource, endpointSource, fallback) {
      // Convex-helpers seeds use zid('<table>') in endpoints; match the first call.
      const m = endpointSource.match(/zid\(\s*'([^']+)'\s*\)/)
      return m ? m[1] : fallback
    },
    buildSchema(entries) {
      const imports = entries.map(e => `import { ${e.pascal}Table } from './models/${e.fileName}'`).join('\n')
      const tables = entries.map(e => `  ${e.table}: ${e.pascal}Table,`).join('\n')
      return `import { defineSchema } from 'convex/server'

${imports}

export default defineSchema({
${tables}
})
`
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
} from '../_generated/server'

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
    buildSchema(entries) {
      const imports = entries.map(e => `import { ${e.pascal}Table } from './models/${e.fileName}'`).join('\n')
      const tables = entries.map(e => `  ${e.table}: ${e.pascal}Table,`).join('\n')
      return `import { defineSchema } from 'convex/server'

${imports}

export default defineSchema({
${tables}
})
`
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
} from '../_generated/server'

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
  spec: FlavorSpec
): string {
  let out = source
  out = out.replaceAll(`'${seed.tableName}'`, `'${newTable}'`)
  for (const s of spec.pascalSuffixes) {
    out = out.replaceAll(`${seed.pascal}${s}`, `${newPascal}${s}`)
  }
  const newFields = `${newPascal.charAt(0).toLowerCase() + newPascal.slice(1)}Fields`
  out = out.replaceAll(seed.fieldsExport, newFields)
  out = out.replaceAll(`../models/${seed.name}`, `../models/${seed.name}_${suffix}`)
  return out
}

export function compose(config: ComposeConfig): { modelsDir: string; endpointsDir: string; outputDir: string } {
  const { count, outputDir } = config
  const flavor: Flavor = config.flavor ?? 'zodvex'
  const spec = FLAVORS[flavor]
  const modelsDir = join(outputDir, 'models')
  const endpointsDir = join(outputDir, 'endpoints')

  // Targeted wipe: only the files compose owns. We're typically writing into
  // a real Convex project root that contains `_generated/`, `convex.config.ts`,
  // and `tsconfig.json` — those must survive.
  if (existsSync(modelsDir)) rmSync(modelsDir, { recursive: true })
  if (existsSync(endpointsDir)) rmSync(endpointsDir, { recursive: true })
  for (const f of ['schema.ts', 'functions.ts', 'summary.json', '_zodvex']) {
    const p = join(outputDir, f)
    if (existsSync(p)) rmSync(p, { recursive: true })
  }
  mkdirSync(outputDir, { recursive: true })
  mkdirSync(modelsDir, { recursive: true })
  mkdirSync(endpointsDir, { recursive: true })

  const seeds = loadSeeds(flavor)
  if (seeds.length === 0) throw new Error(`No seed files found for flavor '${flavor}'`)

  const entries: Array<{ table: string; fileName: string; pascal: string }> = []

  for (let i = 0; i < count; i++) {
    const seed = seeds[i % seeds.length]
    const suffix = String(i).padStart(4, '0')
    const newTable = `${seed.tableName}_${suffix}`
    const newPascal = `${seed.pascal}${suffix}`
    const fileName = `${seed.name}_${suffix}`

    const modelOut = renameSeed(seed.modelSource, seed, suffix, newTable, newPascal, spec)
    writeFileSync(join(modelsDir, `${fileName}.ts`), modelOut)

    if (seed.endpointSource) {
      const endpointOut = renameSeed(seed.endpointSource, seed, suffix, newTable, newPascal, spec)
      writeFileSync(join(endpointsDir, `${fileName}.ts`), endpointOut)
    }

    entries.push({ table: newTable, fileName, pascal: newPascal })
  }

  writeFileSync(join(outputDir, 'schema.ts'), spec.buildSchema(entries))

  const functionsSource = spec.buildFunctions({ withCodegen: config.withCodegen })
  if (functionsSource !== null) {
    writeFileSync(join(outputDir, 'functions.ts'), functionsSource)
  }

  writeFileSync(
    join(outputDir, 'summary.json'),
    JSON.stringify({ count, flavor, withCodegen: !!config.withCodegen, seeds: seeds.length }, null, 2)
  )

  return { modelsDir, endpointsDir, outputDir }
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
