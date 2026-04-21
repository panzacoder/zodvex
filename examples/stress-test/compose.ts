import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'fs'
import { join, basename } from 'path'
import { fileURLToPath } from 'url'

const EXAMPLE_DIR = fileURLToPath(new URL('.', import.meta.url))
const SEEDS_DIR = join(EXAMPLE_DIR, 'seeds')

export interface ComposeConfig {
  count: number
  outputDir: string
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

function toPascal(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function loadSeeds(): SeedInfo[] {
  const modelDir = join(SEEDS_DIR, 'models')
  const endpointDir = join(SEEDS_DIR, 'endpoints')
  const seeds: SeedInfo[] = []

  for (const file of readdirSync(modelDir).filter(f => f.endsWith('.ts')).sort()) {
    const name = basename(file, '.ts')
    const pascal = toPascal(name)
    const modelSource = readFileSync(join(modelDir, file), 'utf-8')
    const endpointPath = join(endpointDir, file)
    const endpointSource = existsSync(endpointPath) ? readFileSync(endpointPath, 'utf-8') : ''

    const tableMatch = modelSource.match(/defineZodModel\(\s*'([^']+)'/)
    const tableName = tableMatch ? tableMatch[1] : name + 's'

    const modelExport = `${pascal}Model`
    const fieldsExport = `${name}Fields`

    seeds.push({ name, pascal, modelSource, endpointSource, tableName, modelExport, fieldsExport })
  }

  return seeds
}

function renameSeed(
  source: string,
  seed: SeedInfo,
  index: number,
  suffix: string,
  newTable: string,
  newPascal: string
): string {
  let out = source
  out = out.replaceAll(`'${seed.tableName}'`, `'${newTable}'`)
  out = out.replaceAll(seed.modelExport, `${newPascal}Model`)
  out = out.replaceAll(seed.fieldsExport, `${newPascal.charAt(0).toLowerCase() + newPascal.slice(1)}Fields`)
  out = out.replaceAll(`../models/${seed.name}`, `../models/${seed.name}_${suffix}`)
  return out
}

export function compose(config: ComposeConfig): { modelsDir: string; endpointsDir: string; outputDir: string } {
  const { count, outputDir } = config
  const modelsDir = join(outputDir, 'models')
  const endpointsDir = join(outputDir, 'endpoints')

  if (existsSync(outputDir)) rmSync(outputDir, { recursive: true })
  mkdirSync(modelsDir, { recursive: true })
  mkdirSync(endpointsDir, { recursive: true })

  const seeds = loadSeeds()
  if (seeds.length === 0) throw new Error('No seed files found')

  const modelImports: string[] = []
  const tableEntries: string[] = []

  for (let i = 0; i < count; i++) {
    const seed = seeds[i % seeds.length]
    const suffix = String(i).padStart(4, '0')
    const newTable = `${seed.tableName}_${suffix}`
    const newPascal = `${seed.pascal}${suffix}`
    const fileName = `${seed.name}_${suffix}`

    const modelOut = renameSeed(seed.modelSource, seed, i, suffix, newTable, newPascal)
    writeFileSync(join(modelsDir, `${fileName}.ts`), modelOut)

    if (seed.endpointSource) {
      const endpointOut = renameSeed(seed.endpointSource, seed, i, suffix, newTable, newPascal)
      writeFileSync(join(endpointsDir, `${fileName}.ts`), endpointOut)
    }

    const modelExport = `${newPascal}Model`
    modelImports.push(`import { ${modelExport} } from './models/${fileName}'`)
    tableEntries.push(`  ${newTable}: ${modelExport},`)
  }

  const schemaSource = `import { defineZodSchema } from 'zodvex/server'

${modelImports.join('\n')}

export default defineZodSchema({
${tableEntries.join('\n')}
})
`
  writeFileSync(join(outputDir, 'schema.ts'), schemaSource)

  const functionsSource = `import { initZodvex } from 'zodvex/server'
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
  writeFileSync(join(outputDir, 'functions.ts'), functionsSource)

  writeFileSync(join(outputDir, 'summary.json'), JSON.stringify({ count, seeds: seeds.length }, null, 2))

  return { modelsDir, endpointsDir, outputDir }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const count = parseInt(args.find(a => a.startsWith('--count='))?.split('=')[1] ?? '50')
  const outputDir = args.find(a => a.startsWith('--output='))?.split('=')[1] ?? join(EXAMPLE_DIR, 'convex', 'composed')

  console.log(`Composing ${count} models from ${readdirSync(join(SEEDS_DIR, 'models')).filter(f => f.endsWith('.ts')).length} seeds`)
  compose({ count, outputDir })
  console.log(`Output: ${outputDir}`)
}
