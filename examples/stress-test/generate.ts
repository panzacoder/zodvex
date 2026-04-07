import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { join } from 'path'
import { transformCode, transformImports } from 'zod-to-mini'
import { Project, type SourceFile } from 'ts-morph'

const EXAMPLE_DIR = fileURLToPath(new URL('.', import.meta.url))

// --- Configuration ---
interface GenerateConfig {
  count: number
  mode: 'tables-only' | 'functions-only' | 'both'
  variant: 'baseline' | 'compiled' | 'zod-mini'
  convex: boolean
  outputDir: string
}

function parseArgs(): GenerateConfig {
  const args = process.argv.slice(2)
  const count = parseInt(args.find(a => a.startsWith('--count='))?.split('=')[1] ?? '50')
  const mode = (args.find(a => a.startsWith('--mode='))?.split('=')[1] ?? 'both') as GenerateConfig['mode']
  const variant = (args.find(a => a.startsWith('--variant='))?.split('=')[1] ?? 'baseline') as GenerateConfig['variant']
  const convex = args.includes('--convex')
  const outputDir = args.find(a => a.startsWith('--output='))?.split('=')[1] ?? join(EXAMPLE_DIR, 'convex', 'generated')

  return { count, mode, variant, convex, outputDir }
}

// --- Template Loading ---
function loadTemplate(dir: string, name: string): string {
  return readFileSync(join(EXAMPLE_DIR, 'templates', dir, `${name}.ts.tmpl`), 'utf-8')
}

// --- Name Generation ---
function modelName(i: number): string {
  return `Model${String(i).padStart(4, '0')}`
}

function tableName(i: number): string {
  return `table_${String(i).padStart(4, '0')}`
}

function fileName(i: number): string {
  return `model_${String(i).padStart(4, '0')}`
}

// --- Complexity Tier ---
type Tier = 'small' | 'medium' | 'large'

function tierFor(i: number, count: number): Tier {
  const ratio = i / count
  if (ratio < 0.5) return 'small'
  if (ratio < 0.85) return 'medium'
  return 'large'
}

// --- Compiler Integration ---
function compileFile(filePath: string): void {
  const code = readFileSync(filePath, 'utf-8')

  // Apply all zod->mini transforms (method chains, class refs, etc.)
  const result = transformCode(code)
  let output = result.code

  // Transform imports: 'zod' -> 'zod/mini', 'zodvex/core' -> 'zodvex/mini'
  const project = new Project({ useInMemoryFileSystem: true })
  const sf = project.createSourceFile('tmp.ts', output)
  transformImports(sf)
  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue()
    if (spec === 'zodvex/core') imp.setModuleSpecifier('zodvex/mini')
  }
  output = sf.getFullText()

  writeFileSync(filePath, output)
}

// --- Extra Args for Function Templates ---
function extraArgsForTier(tier: Tier): string {
  switch (tier) {
    case 'small':
      return 'active: z.boolean(),'
    case 'medium':
      return `status: z.enum(['draft', 'active', 'archived']),
    priority: z.number(),`
    case 'large':
      return `status: z.enum(['draft', 'review', 'active', 'suspended', 'archived']),
    priority: z.number(),
    isPublic: z.boolean(),`
  }
}

// --- Main ---
function generate() {
  const config = parseArgs()
  const { count, mode, variant, outputDir } = config

  console.log(`Generating ${count} modules (mode=${mode}, variant=${variant})`)
  console.log(`Output: ${outputDir}`)

  // Clean output directory
  const modelsDir = join(outputDir, 'models')
  const endpointsDir = join(outputDir, 'endpoints')

  if (existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true })
  }
  mkdirSync(modelsDir, { recursive: true })
  mkdirSync(endpointsDir, { recursive: true })

  // Select template directory based on variant
  const templateDir = variant === 'zod-mini' ? 'mini' : 'zod'

  // Load templates
  const templates = {
    small: loadTemplate(templateDir, 'model-small'),
    medium: loadTemplate(templateDir, 'model-medium'),
    large: loadTemplate(templateDir, 'model-large'),
    functions: loadTemplate(templateDir, 'functions'),
    schema: loadTemplate(templateDir, 'schema'),
  }

  // Generate models
  const modelImports: string[] = []
  const tableEntries: string[] = []

  for (let i = 0; i < count; i++) {
    const name = modelName(i)
    const table = tableName(i)
    const file = fileName(i)
    const tier = tierFor(i, count)

    // Generate model file
    // In 'both' and 'tables-only' modes: full model with defineZodModel + schema registration
    // In 'functions-only' mode: lightweight stub that creates the Zod schema but does NOT
    // call defineZodModel or register with defineZodSchema.
    if (mode === 'functions-only') {
      const docSchema = variant === 'zod-mini'
        ? `z.nullable(z.object(${name}Fields))`
        : `z.object(${name}Fields).nullable()`
      const stubSource = templates[tier]
        .replaceAll('{{NAME}}', name)
        .replaceAll('{{TABLE_NAME}}', table)
        .replaceAll('{{INDEX_FIELD}}', String(i % 10))
        .replace(
          /export const (\w+)Model = defineZodModel\([^)]+\)[\s\S]*$/,
          `export const $1Model = { schema: { doc: ${docSchema} } } as any`
        )
      writeFileSync(join(modelsDir, `${file}.ts`), stubSource)
    } else {
      const modelSource = templates[tier]
        .replaceAll('{{NAME}}', name)
        .replaceAll('{{TABLE_NAME}}', table)
        .replaceAll('{{INDEX_FIELD}}', String(i % 10))

      writeFileSync(join(modelsDir, `${file}.ts`), modelSource)

      modelImports.push(`import { ${name}Model } from './models/${file}'`)
      tableEntries.push(`  ${table}: ${name}Model,`)
    }

    // Generate function file
    if (mode !== 'tables-only') {
      const extraArgs = extraArgsForTier(tier)
      const fnSource = templates.functions
        .replaceAll('{{NAME}}', name)
        .replaceAll('{{TABLE_NAME}}', table)
        .replaceAll('{{FILE_NAME}}', file)
        .replaceAll('{{EXTRA_ARGS}}', extraArgs)

      writeFileSync(join(endpointsDir, `${file}.ts`), fnSource)
    }
  }

  // Generate schema.ts (only in modes that include tables)
  if (mode !== 'functions-only') {
    const schemaSource = templates.schema
      .replace('{{MODEL_IMPORTS}}', modelImports.join('\n'))
      .replace('{{TABLE_ENTRIES}}', tableEntries.join('\n'))

    writeFileSync(join(outputDir, 'schema.ts'), schemaSource)
  }

  // For 'compiled' variant: run the zod-to-mini compiler on all generated files
  if (variant === 'compiled') {
    console.log('Running zod-to-mini compiler on generated files...')

    // Compile model files
    for (const f of readdirSync(modelsDir)) {
      if (f.endsWith('.ts')) compileFile(join(modelsDir, f))
    }

    // Compile endpoint files
    if (mode !== 'tables-only') {
      for (const f of readdirSync(endpointsDir)) {
        if (f.endsWith('.ts')) compileFile(join(endpointsDir, f))
      }
    }

    // Compile schema.ts
    if (mode !== 'functions-only' && existsSync(join(outputDir, 'schema.ts'))) {
      compileFile(join(outputDir, 'schema.ts'))
    }

    console.log('Compiler pass complete.')
  }

  // Generate functions.ts bootstrap
  if (mode !== 'tables-only') {
    let functionsSource: string
    if (config.convex) {
      functionsSource = readFileSync(
        join(EXAMPLE_DIR, 'templates', templateDir, 'functions-bootstrap.ts.tmpl'),
        'utf-8'
      )
    } else {
      functionsSource = `// Use initZodvex with wrapDb disabled so generated handlers keep
// the real Convex ctx types during standalone heap measurement.
import { initZodvex } from 'zodvex/server'
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
    }
    writeFileSync(join(outputDir, 'functions.ts'), functionsSource)
  }

  // Generate summary
  const summary = {
    count,
    mode,
    variant,
    tiers: {
      small: Array.from({ length: count }, (_, i) => tierFor(i, count)).filter(t => t === 'small').length,
      medium: Array.from({ length: count }, (_, i) => tierFor(i, count)).filter(t => t === 'medium').length,
      large: Array.from({ length: count }, (_, i) => tierFor(i, count)).filter(t => t === 'large').length,
    },
  }

  writeFileSync(join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(`Generated ${count} modules:`, summary.tiers)
}

generate()
