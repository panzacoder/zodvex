import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'

// --- Configuration ---
interface GenerateConfig {
  count: number
  mode: 'tables-only' | 'functions-only' | 'both'
  variant: 'baseline' | 'zod-mini'
  convex: boolean
  outputDir: string
}

function parseArgs(): GenerateConfig {
  const args = process.argv.slice(2)
  const count = parseInt(args.find(a => a.startsWith('--count='))?.split('=')[1] ?? '50')
  const mode = (args.find(a => a.startsWith('--mode='))?.split('=')[1] ?? 'both') as GenerateConfig['mode']
  const variant = (args.find(a => a.startsWith('--variant='))?.split('=')[1] ?? 'baseline') as GenerateConfig['variant']
  const convex = args.includes('--convex')
  const outputDir = args.find(a => a.startsWith('--output='))?.split('=')[1] ?? join(import.meta.dir, 'convex', 'generated')

  return { count, mode, variant, convex, outputDir }
}

// --- Template Loading ---
function loadTemplate(name: string): string {
  return readFileSync(join(import.meta.dir, 'templates', `${name}.ts.tmpl`), 'utf-8')
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

// --- Variant Transforms ---
function applyVariant(source: string, variant: GenerateConfig['variant']): string {
  if (variant === 'baseline') return source

  if (variant === 'zod-mini') {
    let result = source
      // Switch to zod/mini and zodvex/mini imports
      .replace("import { z } from 'zod'", "import { z } from 'zod/mini'")
      .replace("from 'zodvex/core'", "from 'zodvex/mini'")
      // discriminatedUnion → union (mini doesn't have discriminatedUnion)
      .replace(/z\.discriminatedUnion\('[^']+',\s*/g, 'z.union(')

    // Rewrite .optional() and .nullable() chaining → z.optional()/z.nullable() wrapping.
    // zod-mini uses functional form: z.optional(x) not x.optional().
    //
    // Three expression categories that appear in templates:
    //   1. z.func(args) / zx.func(args) — e.g., z.string(), zx.id('users'), z.object(Fields)
    //   2. Identifier — e.g., Model0004Metadata, Model0004Config
    //   3. expr.prop.prop — e.g., Model0004Model.schema.doc

    // Category 1: z.func(args).optional() / zx.func(args).optional()
    // [^)]* handles single-level parens (no nesting — templates extract nested objects to variables)
    result = result.replace(/(zx?\.\w+\([^)]*\))\.optional\(\)/g, 'z.optional($1)')
    result = result.replace(/(zx?\.\w+\([^)]*\))\.nullable\(\)/g, 'z.nullable($1)')

    // Category 3: dotted.path.expr.optional() — e.g., Model.schema.doc.nullable()
    // Must run before Category 2 so the full dotted path is captured, not just the last segment.
    result = result.replace(/(\b[A-Z]\w+(?:\.\w+)+)\.optional\(\)/g, 'z.optional($1)')
    result = result.replace(/(\b[A-Z]\w+(?:\.\w+)+)\.nullable\(\)/g, 'z.nullable($1)')

    // Category 2: Identifier.optional() — e.g., ModelMetadata.optional()
    result = result.replace(/(\b[A-Z]\w+)\.optional\(\)/g, 'z.optional($1)')
    result = result.replace(/(\b[A-Z]\w+)\.nullable\(\)/g, 'z.nullable($1)')

    return result
  }

  return source
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

  // Load templates
  const templates = {
    small: loadTemplate('model-small'),
    medium: loadTemplate('model-medium'),
    large: loadTemplate('model-large'),
    functions: loadTemplate('functions'),
    schema: loadTemplate('schema'),
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
      const stubSource = templates[tier]
        .replaceAll('{{NAME}}', name)
        .replaceAll('{{TABLE_NAME}}', table)
        .replaceAll('{{INDEX_FIELD}}', String(i % 10))
        .replace(
          /export const (\w+)Model = defineZodModel\([^)]+\)[\s\S]*$/,
          `export const $1Model = { schema: { doc: z.object(${name}Fields).nullable() } } as any`
        )
      writeFileSync(join(modelsDir, `${file}.ts`), applyVariant(stubSource, variant))
    } else {
      let modelSource = templates[tier]
        .replaceAll('{{NAME}}', name)
        .replaceAll('{{TABLE_NAME}}', table)
        .replaceAll('{{INDEX_FIELD}}', String(i % 10))

      modelSource = applyVariant(modelSource, variant)
      writeFileSync(join(modelsDir, `${file}.ts`), modelSource)

      modelImports.push(`import { ${name}Model } from './models/${file}'`)
      tableEntries.push(`  ${table}: ${name}Model,`)
    }

    // Generate function file
    if (mode !== 'tables-only') {
      const extraArgs = extraArgsForTier(tier)
      let fnSource = templates.functions
        .replaceAll('{{NAME}}', name)
        .replaceAll('{{TABLE_NAME}}', table)
        .replaceAll('{{FILE_NAME}}', file)
        .replaceAll('{{EXTRA_ARGS}}', extraArgs)

      fnSource = applyVariant(fnSource, variant)
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

  // Generate functions.ts bootstrap
  if (mode !== 'tables-only') {
    let functionsSource: string
    if (config.convex) {
      functionsSource = readFileSync(
        join(import.meta.dir, 'templates', 'functions-bootstrap.ts.tmpl'),
        'utf-8'
      )
    } else {
      functionsSource = `// Mock functions.ts for standalone heap measurement (no Convex codegen)
import { zQueryBuilder, zMutationBuilder } from 'zodvex/server'

const stubBuilder = (config: any) => config
export const zq = zQueryBuilder(stubBuilder as any)
export const zm = zMutationBuilder(stubBuilder as any)
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
