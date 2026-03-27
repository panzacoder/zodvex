# Zod v4 OOM Mitigation — Phase 0: Stress-Test & Measurement

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stress-test harness that reproduces the Zod v4 OOM issue in Convex's 64MB isolate, measures memory across variants (baseline zod, zod-mini), and produces data to drive Phase 1 decisions.

**Architecture:** A generator script stamps out N Convex modules from templates at configurable scale points. A measurement script runs V8 heap snapshots before/after module initialization. Two generator variants are measured: **baseline** (current eager zod) and **zod-mini** (same schemas via zod/mini). Tables-only, functions-only, and combined modes isolate allocation attribution. A **Convex-validator-only control** (built into the measurement script, not the generator) measures the cost of equivalent `v.*` validators without any Zod — the difference `baseline - convex_only` gives the upper bound of what lazy loading could save. This avoids the fragility of trying to generate Zod-free modules that still work with zodvex's registration APIs.

**Tech Stack:** TypeScript, Bun, Zod v4, zod/mini, Convex, v8 module (heap statistics)

**Spec:** `docs/superpowers/specs/2026-03-26-zod-v4-oom-mitigation-design.md`

**Key finding from research:** `ZodMiniType` extends `core.$ZodType` — they share the same base class. The 91-property-per-schema problem may affect mini equally. Measurement will confirm or deny this.

---

## File Structure

```
examples/stress-test/
├── package.json                    # Workspace package, deps on zodvex, zod, convex
├── tsconfig.json                   # Standard Convex-compatible TS config
├── convex/
│   ├── convex.config.ts            # Minimal Convex app config
│   ├── tsconfig.json               # Convex tsconfig
│   └── .gitkeep                    # Generated modules go here (gitignored)
├── generate.ts                     # Generator script — stamps out N modules
├── templates/
│   ├── model-small.ts.tmpl         # 3-5 field model template
│   ├── model-medium.ts.tmpl        # 8-12 field model template with codecs
│   ├── model-large.ts.tmpl         # 15-20 field model template with unions
│   ├── functions.ts.tmpl           # Query + mutation per model
│   └── schema.ts.tmpl              # defineZodSchema aggregator
├── measure.ts                      # V8 heap measurement script
├── report.ts                       # Collects measurements, outputs markdown table
└── results/                        # Generated reports (committed for decision doc)
```

---

## Task 1: Scaffold the stress-test example project

**Files:**
- Create: `examples/stress-test/package.json`
- Create: `examples/stress-test/tsconfig.json`
- Create: `examples/stress-test/convex/convex.config.ts`
- Create: `examples/stress-test/convex/tsconfig.json`
- Create: `examples/stress-test/convex/.gitkeep`
- Create: `examples/stress-test/.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "stress-test",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "generate": "bun run generate.ts",
    "measure": "bun run measure.ts",
    "report": "bun run report.ts"
  },
  "dependencies": {
    "convex": "^1.28.0",
    "convex-helpers": ">=0.1.101-alpha.1",
    "zod": "4.3.6",
    "zodvex": "workspace:*"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "outDir": "./dist",
    "rootDir": ".",
    "types": ["bun-types"]
  },
  "include": ["*.ts", "templates/**/*.ts"],
  "exclude": ["convex", "node_modules", "dist"]
}
```

- [ ] **Step 3: Create convex config files**

`convex/convex.config.ts`:
```typescript
import { defineApp } from 'convex/server'
const app = defineApp()
export default app
```

`convex/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["ESNext", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "allowJs": true,
    "outDir": "../node_modules/.cache/convex-gen",
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["./**/*", "../node_modules/.cache/convex-gen/**/*"],
  "exclude": ["./_generated"]
}
```

- [ ] **Step 4: Create .gitignore**

```
convex/generated/
node_modules/
```

Note: `results/` is NOT gitignored — we commit the measurement reports for the Phase 0 → Phase 1 decision document.

- [ ] **Step 5: Run `bun install` to link workspace**

The root `package.json` already has `"workspaces": ["packages/*", "examples/*"]` which covers the new project.

Run: `bun install`
Expected: stress-test package linked, zodvex resolved via workspace:*

- [ ] **Step 6: Commit scaffold**

```bash
git add examples/stress-test/ bun.lock
git commit -m "chore: scaffold stress-test example project for OOM measurement"
```

---

## Task 2: Build model templates (small, medium, large)

**Files:**
- Create: `examples/stress-test/templates/model-small.ts.tmpl`
- Create: `examples/stress-test/templates/model-medium.ts.tmpl`
- Create: `examples/stress-test/templates/model-large.ts.tmpl`

Templates use `{{NAME}}`, `{{TABLE_NAME}}`, and `{{INDEX_FIELD}}` placeholders that the generator replaces.

- [ ] **Step 1: Create small model template (3-5 fields)**

`templates/model-small.ts.tmpl`:
```typescript
import { z } from 'zod'
import { defineZodModel, zx } from 'zodvex/core'

export const {{NAME}}Fields = {
  title: z.string(),
  active: z.boolean(),
  count: z.number(),
  createdAt: zx.date(),
}

export const {{NAME}}Model = defineZodModel('{{TABLE_NAME}}', {{NAME}}Fields)
  .index('by_created', ['createdAt'])
```

- [ ] **Step 2: Create medium model template (8-12 fields with codecs)**

`templates/model-medium.ts.tmpl`:
```typescript
import { z } from 'zod'
import { defineZodModel, zx } from 'zodvex/core'

export const {{NAME}}Fields = {
  title: z.string(),
  description: z.string().optional(),
  status: z.enum(['draft', 'active', 'archived']),
  priority: z.number(),
  ownerId: zx.id('users_{{INDEX_FIELD}}'),
  tags: z.array(z.string()),
  metadata: z.object({
    source: z.string(),
    version: z.number(),
  }).optional(),
  isPublic: z.boolean(),
  score: z.number().nullable(),
  createdAt: zx.date(),
  updatedAt: zx.date().optional(),
}

export const {{NAME}}Model = defineZodModel('{{TABLE_NAME}}', {{NAME}}Fields)
  .index('by_owner', ['ownerId'])
  .index('by_status', ['status'])
  .index('by_created', ['createdAt'])
```

- [ ] **Step 3: Create large model template (15-20 fields with unions)**

`templates/model-large.ts.tmpl`:
```typescript
import { z } from 'zod'
import { defineZodModel, zx } from 'zodvex/core'

const addressSchema = z.object({
  street: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  country: z.string().optional(),
})

const contactVariantA = z.object({
  kind: z.literal('email'),
  email: z.string(),
  verified: z.boolean(),
})

const contactVariantB = z.object({
  kind: z.literal('phone'),
  phone: z.string(),
  extension: z.string().optional(),
})

const contactVariantC = z.object({
  kind: z.literal('address'),
  address: addressSchema,
  isPrimary: z.boolean(),
})

export const {{NAME}}Fields = {
  title: z.string(),
  description: z.string().optional(),
  status: z.enum(['draft', 'review', 'active', 'suspended', 'archived']),
  priority: z.number(),
  ownerId: zx.id('users_{{INDEX_FIELD}}'),
  assigneeId: zx.id('users_{{INDEX_FIELD}}').optional(),
  contact: z.discriminatedUnion('kind', [contactVariantA, contactVariantB, contactVariantC]),
  tags: z.array(z.string()),
  labels: z.array(z.object({ name: z.string(), color: z.string() })),
  metadata: z.object({
    source: z.string(),
    version: z.number(),
    features: z.array(z.string()),
    config: z.object({
      enabled: z.boolean(),
      threshold: z.number().optional(),
    }).optional(),
  }),
  notes: z.array(z.object({
    text: z.string(),
    authorId: zx.id('users_{{INDEX_FIELD}}'),
    createdAt: zx.date(),
  })),
  isPublic: z.boolean(),
  score: z.number().nullable(),
  rating: z.number().optional(),
  retryCount: z.number(),
  lastActivityAt: zx.date().optional(),
  createdAt: zx.date(),
  updatedAt: zx.date().optional(),
}

export const {{NAME}}Model = defineZodModel('{{TABLE_NAME}}', {{NAME}}Fields)
  .index('by_owner', ['ownerId'])
  .index('by_status', ['status'])
  .index('by_created', ['createdAt'])
  .index('by_priority', ['priority'])
```

- [ ] **Step 4: Commit templates**

```bash
git add examples/stress-test/templates/
git commit -m "feat(stress-test): add small/medium/large model templates"
```

---

## Task 3: Build function template

**Files:**
- Create: `examples/stress-test/templates/functions.ts.tmpl`

Each generated function file has a query and mutation per model, mirroring real-world usage.

- [ ] **Step 1: Create function template**

`templates/functions.ts.tmpl`:
```typescript
import { z } from 'zod'
import { zx } from 'zodvex/core'
import { zq, zm } from '../functions'
import { {{NAME}}Model } from '../models/{{FILE_NAME}}'

export const get{{NAME}} = zq({
  args: { id: zx.id('{{TABLE_NAME}}') },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id)
  },
  returns: {{NAME}}Model.schema.doc.nullable(),
})

export const create{{NAME}} = zm({
  args: {
    title: z.string(),
    {{EXTRA_ARGS}}
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('{{TABLE_NAME}}', {
      ...args,
      createdAt: new Date(),
    })
  },
  returns: zx.id('{{TABLE_NAME}}'),
})
```

- [ ] **Step 2: Commit function template**

```bash
git add examples/stress-test/templates/functions.ts.tmpl
git commit -m "feat(stress-test): add function template for query/mutation per model"
```

---

## Task 4: Build the generator script

**Files:**
- Create: `examples/stress-test/generate.ts`
- Create: `examples/stress-test/templates/schema.ts.tmpl`
- Create: `examples/stress-test/templates/functions-bootstrap.ts.tmpl`

The generator stamps out N modules, respecting the complexity distribution (50% small, 35% medium, 15% large) and the mode (tables-only, functions-only, both).

- [ ] **Step 1: Create schema and functions bootstrap templates**

`templates/schema.ts.tmpl`:
```typescript
import { defineZodSchema } from 'zodvex'
{{MODEL_IMPORTS}}

export default defineZodSchema({
{{TABLE_ENTRIES}}
})
```

`templates/functions-bootstrap.ts.tmpl` (creates the `zq`/`zm` exports that endpoint files import):
```typescript
import { initZodvex } from 'zodvex/server'
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
})
```

**Note:** This file depends on Convex's `_generated/server` which only exists after `npx convex dev` runs codegen. For standalone V8 heap measurement (no Convex), the generator should also produce a **mock** `functions.ts` that creates `zq`/`zm` using the lower-level builders directly:

```typescript
// Mock functions.ts for standalone heap measurement (no Convex codegen)
import { zQueryBuilder, zMutationBuilder } from 'zodvex/server'

// Stub builder that captures args but doesn't register with Convex
const stubBuilder = (config: any) => config
export const zq = zQueryBuilder(stubBuilder as any)
export const zm = zMutationBuilder(stubBuilder as any)
```

The generator should emit the mock version by default and the real version when `--convex` flag is passed.

- [ ] **Step 2: Create the generator script**

`generate.ts`:
```typescript
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'

// --- Configuration ---
interface GenerateConfig {
  count: number
  mode: 'tables-only' | 'functions-only' | 'both'
  variant: 'baseline' | 'zod-mini'
  convex: boolean  // true = emit real Convex bootstrap (needs npx convex dev); false = emit mock stubs
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
    // Replace zod import with zod/mini and adapt API differences.
    // Key differences: z.enum() → z.enum(), z.discriminatedUnion() → z.union()
    // (zod-mini has z.enum but z.discriminatedUnion may behave differently).
    //
    // NOTE: Some generated files may fail to compile with zod-mini due to API
    // gaps (e.g., discriminatedUnion differences). If ANY module fails to import,
    // the measurement run is INVALID — the measurement script will abort and
    // report it as an API compatibility failure rather than recording a misleading
    // lower heap number. This is itself useful Phase 0 data: it tells us the
    // API surface delta and whether Track B needs separate mini-specific templates.
    return source.replace(
      "import { z } from 'zod'",
      "import { z } from 'zod/mini'"
    )
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
    // call defineZodModel or register with defineZodSchema. This isolates function-wrapper
    // allocation from table-registration allocation while keeping endpoint imports valid.
    if (mode === 'functions-only') {
      // Stub: exports the model-like shape so endpoint files can import it,
      // but does NOT call defineZodModel (no table registration overhead).
      const stubSource = templates[tier]
        .replaceAll('{{NAME}}', name)
        .replaceAll('{{TABLE_NAME}}', table)
        .replaceAll('{{INDEX_FIELD}}', String(i % 10))
        // Replace defineZodModel call with a minimal stub that has .schema.doc
        .replace(
          /export const (\w+)Model = defineZodModel\([^)]+\)[\s\S]*$/,
          `export const $1Model = { schema: { doc: z.object(${name}Fields).nullable() } } as any`
        )
      writeFileSync(join(modelsDir, `${file}.ts`), applyVariant(stubSource, variant))
    } else {
      let modelSource = templates[tier]
        .replaceAll('{{NAME}}', name)
        .replaceAll('{{TABLE_NAME}}', table)
        .replaceAll('{{INDEX_FIELD}}', String(i % 10)) // Reuse some user tables

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
      // Real Convex bootstrap — requires `npx convex dev` to generate _generated/server
      functionsSource = readFileSync(
        join(import.meta.dir, 'templates', 'functions-bootstrap.ts.tmpl'),
        'utf-8'
      )
    } else {
      // Mock bootstrap for standalone heap measurement (no Convex codegen needed)
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
```

- [ ] **Step 3: Test the generator**

Run: `cd examples/stress-test && bun run generate.ts --count=10 --mode=both --variant=baseline`
Expected: `convex/generated/` populated with 10 model files, 10 endpoint files, schema.ts, summary.json

Verify a generated model file looks correct:
Run: `cat examples/stress-test/convex/generated/models/model_0000.ts`
Expected: A valid TypeScript file with zodvex model definition

- [ ] **Step 4: Test all three variants generate correctly**

Run:
```bash
cd examples/stress-test
bun run generate.ts --count=5 --variant=baseline && echo "--- baseline OK ---"
bun run generate.ts --count=5 --variant=zod-mini && echo "--- zod-mini OK ---"
```
Expected: Each variant generates valid files. Spot-check that zod-mini variant has `import { z } from 'zod/mini'`.

- [ ] **Step 5: Commit generator**

```bash
git add examples/stress-test/generate.ts examples/stress-test/templates/schema.ts.tmpl examples/stress-test/templates/functions-bootstrap.ts.tmpl
git commit -m "feat(stress-test): add module generator with variant and mode support"
```

---

## Task 5: Build the measurement script

**Files:**
- Create: `examples/stress-test/measure.ts`

This is the core of Phase 0. It measures V8 heap before/after importing generated modules.

- [ ] **Step 1: Create the measurement script**

`measure.ts`:
```typescript
import { join } from 'path'
import v8 from 'v8'
import { writeFileSync, existsSync, readdirSync } from 'fs'

// --- Types ---
interface MeasureConfig {
  variant: 'baseline' | 'zod-mini' | 'convex-only'
  mode: 'tables-only' | 'functions-only' | 'both'
  count: number
}

interface MeasureResult {
  variant: string
  mode: string
  count: number
  heapBefore: number
  heapAfter: number
  heapDelta: number
  heapDeltaMB: string
  heapPeakMB: string  // Absolute peak — important since 64MB limit is absolute
  modulesLoaded: number   // How many modules successfully imported
  modulesFailed: number   // How many failed (zod-mini API gaps, etc.)
  externalBefore: number
  externalAfter: number
  timestamp: string
}

// --- Helpers ---
function forceGC() {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc()
  } else {
    console.warn('GC not exposed. Run with --expose-gc for accurate measurements.')
  }
}

function getHeapStats() {
  const stats = v8.getHeapStatistics()
  return {
    heapUsed: stats.used_heap_size,
    heapTotal: stats.total_heap_size,
    external: stats.external_memory,
  }
}

function parseArgs(): MeasureConfig {
  const args = process.argv.slice(2)
  const variant = (args.find(a => a.startsWith('--variant='))?.split('=')[1] ?? 'baseline') as MeasureConfig['variant']
  const mode = (args.find(a => a.startsWith('--mode='))?.split('=')[1] ?? 'both') as MeasureConfig['mode']
  const count = parseInt(args.find(a => a.startsWith('--count='))?.split('=')[1] ?? '50')
  return { variant, mode, count }
}

// NOTE: Zod/zod-mini import baselines are measured by report.ts in isolated
// processes (to avoid module cache contamination). measure.ts does NOT measure
// import baselines — only schema creation and Convex-validator-only controls.

// --- Schema Creation Measurement ---
// IMPORTANT: This script is designed to be called from report.ts, which
// runs each measurement in a separate process for isolation. Each invocation
// measures schema creation for one variant/mode/count combination (specified
// via --variant, --mode, --count flags).
async function measureSchemaCreation(config: MeasureConfig): Promise<MeasureResult> {
  const { variant, mode, count } = config
  const outputDir = join(import.meta.dir, 'convex', 'generated')

  if (!existsSync(outputDir)) {
    throw new Error(`Generated modules not found at ${outputDir}. Run generate.ts first.`)
  }

  // Pre-import zod and zodvex so we only measure schema creation cost
  if (variant === 'zod-mini') {
    await import('zod/mini')
  } else {
    await import('zod')
  }
  await import('zodvex/server')
  await import('zodvex/core')

  forceGC()
  forceGC() // Double GC for more stable baseline
  const before = getHeapStats()

  // For tables-only or both: import schema.ts which calls defineZodSchema()
  // This is the critical path — defineZodSchema eagerly iterates all tables
  // and calls zodToConvex for each, which is the main allocation site.
  if (mode !== 'functions-only') {
    const schemaPath = join(outputDir, 'schema.ts')
    if (existsSync(schemaPath)) {
      await import(schemaPath)
    } else {
      // Fallback: import individual models if schema.ts not generated
      const modelsDir = join(outputDir, 'models')
      if (existsSync(modelsDir)) {
        const modelFiles = readdirSync(modelsDir).filter(f => f.endsWith('.ts'))
        for (const file of modelFiles) {
          await import(join(modelsDir, file))
        }
      }
    }
  }

  // For functions-only or both: import all endpoint files
  // These call zq()/zm() which create z.object() wrappers and zodToConvex
  let endpointsLoaded = 0
  let endpointsFailed = 0
  if (mode !== 'tables-only') {
    const endpointsDir = join(outputDir, 'endpoints')
    if (existsSync(endpointsDir)) {
      const endpointFiles = readdirSync(endpointsDir).filter(f => f.endsWith('.ts'))
      for (const file of endpointFiles) {
        try {
          await import(join(endpointsDir, file))
          endpointsLoaded++
        } catch (e) {
          endpointsFailed++
          console.error(`FAILED to import ${file}: ${(e as Error).message}`)
        }
      }

      // If ANY module failed, this measurement is invalid — don't record
      // a misleading lower heap number from a partial load.
      if (endpointsFailed > 0) {
        throw new Error(
          `${endpointsFailed}/${endpointsFailed + endpointsLoaded} endpoint modules failed to import. ` +
          `This ${variant} measurement is INVALID — partial loads are not comparable. ` +
          `The variant likely needs dedicated templates to handle API differences.`
        )
      }
    }
  }

  forceGC()
  forceGC()
  const after = getHeapStats()

  const totalLoaded = endpointsLoaded + (mode !== 'functions-only' ? count : 0)

  const delta = after.heapUsed - before.heapUsed
  return {
    variant,
    mode,
    count,
    heapBefore: before.heapUsed,
    heapAfter: after.heapUsed,
    heapDelta: delta,
    heapDeltaMB: (delta / 1024 / 1024).toFixed(2),
    heapPeakMB: (after.heapUsed / 1024 / 1024).toFixed(2),
    modulesLoaded: totalLoaded,
    modulesFailed: 0,  // If we got here, all modules loaded (failures throw above)
    externalBefore: before.external,
    externalAfter: after.external,
    timestamp: new Date().toISOString(),
  }
}

// --- Convex Validator Baseline ---
async function measureConvexValidatorBaseline(count: number): Promise<MeasureResult> {
  const { v } = await import('convex/values')

  forceGC()
  const before = getHeapStats()

  // Create equivalent Convex validators directly (no Zod).
  // IMPORTANT: Retain all validators in an array so GC doesn't reclaim them.
  // This makes the measurement comparable to module-cached zodvex imports
  // where all validators stay resident in the module cache.
  const retained: any[] = []

  for (let i = 0; i < count; i++) {
    const ratio = i / count
    if (ratio < 0.5) {
      // Small — 4 fields
      retained.push(v.object({
        title: v.string(),
        active: v.boolean(),
        count: v.float64(),
        createdAt: v.float64(),
      }))
    } else if (ratio < 0.85) {
      // Medium — 11 fields
      retained.push(v.object({
        title: v.string(),
        description: v.optional(v.string()),
        status: v.union(v.literal('draft'), v.literal('active'), v.literal('archived')),
        priority: v.float64(),
        ownerId: v.id('users_0'),
        tags: v.array(v.string()),
        metadata: v.optional(v.object({ source: v.string(), version: v.float64() })),
        isPublic: v.boolean(),
        score: v.union(v.float64(), v.null()),
        createdAt: v.float64(),
        updatedAt: v.optional(v.float64()),
      }))
    } else {
      // Large — 18 fields with union
      retained.push(v.object({
        title: v.string(),
        description: v.optional(v.string()),
        status: v.union(v.literal('draft'), v.literal('review'), v.literal('active'), v.literal('suspended'), v.literal('archived')),
        priority: v.float64(),
        ownerId: v.id('users_0'),
        assigneeId: v.optional(v.id('users_0')),
        contact: v.union(
          v.object({ kind: v.literal('email'), email: v.string(), verified: v.boolean() }),
          v.object({ kind: v.literal('phone'), phone: v.string(), extension: v.optional(v.string()) }),
          v.object({ kind: v.literal('address'), address: v.object({ street: v.string(), city: v.string(), state: v.string(), zip: v.string(), country: v.optional(v.string()) }), isPrimary: v.boolean() }),
        ),
        tags: v.array(v.string()),
        labels: v.array(v.object({ name: v.string(), color: v.string() })),
        metadata: v.object({ source: v.string(), version: v.float64(), features: v.array(v.string()), config: v.optional(v.object({ enabled: v.boolean(), threshold: v.optional(v.float64()) })) }),
        notes: v.array(v.object({ text: v.string(), authorId: v.id('users_0'), createdAt: v.float64() })),
        isPublic: v.boolean(),
        score: v.union(v.float64(), v.null()),
        rating: v.optional(v.float64()),
        retryCount: v.float64(),
        lastActivityAt: v.optional(v.float64()),
        createdAt: v.float64(),
        updatedAt: v.optional(v.float64()),
      }))
    }
  }

  // Keep retained alive past the GC call
  forceGC()
  const after = getHeapStats()

  // Prevent retained from being optimized away
  if (retained.length === -1) console.log(retained)

  const delta = after.heapUsed - before.heapUsed
  return {
    variant: 'convex-only',
    mode: 'both',
    count,
    heapBefore: before.heapUsed,
    heapAfter: after.heapUsed,
    heapDelta: delta,
    heapDeltaMB: (delta / 1024 / 1024).toFixed(2),
    heapPeakMB: (after.heapUsed / 1024 / 1024).toFixed(2),
    modulesLoaded: count,
    modulesFailed: 0,
    externalBefore: before.external,
    externalAfter: after.external,
    timestamp: new Date().toISOString(),
  }
}

// --- Per-Schema Property Count ---
async function measurePropertyCount(): Promise<void> {
  const { z } = await import('zod')
  const zm = await import('zod/mini')

  const zodSchema = z.object({ a: z.string(), b: z.number() })
  const miniSchema = zm.z.object({ a: zm.z.string(), b: zm.z.number() })

  console.log('\n--- Per-Schema Property Count ---')
  console.log(`z.object() own properties: ${Object.getOwnPropertyNames(zodSchema).length}`)
  console.log(`z.string() own properties: ${Object.getOwnPropertyNames(z.string()).length}`)
  console.log(`zm.object() own properties: ${Object.getOwnPropertyNames(miniSchema).length}`)
  console.log(`zm.string() own properties: ${Object.getOwnPropertyNames(zm.z.string()).length}`)

  // Also check prototype chain depth
  let proto = Object.getPrototypeOf(zodSchema)
  let depth = 0
  while (proto && proto !== Object.prototype) {
    depth++
    proto = Object.getPrototypeOf(proto)
  }
  console.log(`z.object() prototype chain depth: ${depth}`)

  proto = Object.getPrototypeOf(miniSchema)
  depth = 0
  while (proto && proto !== Object.prototype) {
    depth++
    proto = Object.getPrototypeOf(proto)
  }
  console.log(`zm.object() prototype chain depth: ${depth}`)
}

// --- Main ---
// This script measures ONE thing per invocation: schema creation for a specific
// variant/mode/count. Import baselines (zod vs zod-mini) are measured separately
// by report.ts in isolated processes to avoid module cache contamination.
async function main() {
  const config = parseArgs()

  const resultsDir = join(import.meta.dir, 'results')
  if (!existsSync(resultsDir)) {
    const { mkdirSync } = await import('fs')
    mkdirSync(resultsDir, { recursive: true })
  }

  // Property counts (lightweight, doesn't affect heap measurement much)
  await measurePropertyCount()

  // Measure Convex-only baseline (no Zod) at the same scale
  console.log('\n--- Convex Validator Baseline ---')
  const convexBaseline = await measureConvexValidatorBaseline(config.count)
  console.log(`Convex validators (${config.count}): +${convexBaseline.heapDeltaMB} MB`)
  console.log(`Lazy loading upper bound = schema_heap - ${convexBaseline.heapDeltaMB} MB`)

  // Measure schema creation for the requested variant
  console.log('\n--- Schema Creation ---')
  const result = await measureSchemaCreation(config)
  console.log(`${result.variant} (${result.mode}, ${result.count}): +${result.heapDeltaMB} MB (peak: ${result.heapPeakMB} MB)`)

  // Save result
  const resultFile = join(resultsDir, `${config.variant}-${config.mode}-${config.count}.json`)
  writeFileSync(resultFile, JSON.stringify({ convexBaseline, result }, null, 2))
  console.log(`\nResult saved to ${resultFile}`)
}

main().catch(console.error)
```

- [ ] **Step 2: Verify measurement script runs**

First generate modules, then measure:
```bash
cd examples/stress-test
bun run generate.ts --count=50 --mode=both --variant=baseline
bun --expose-gc run measure.ts --count=50 --mode=both --variant=baseline
```

Expected: Property counts printed, heap measurements printed, result saved to `results/`.

- [ ] **Step 3: Commit measurement script**

```bash
git add examples/stress-test/measure.ts
git commit -m "feat(stress-test): add V8 heap measurement script with baselines"
```

---

## Task 6: Build the report script

**Files:**
- Create: `examples/stress-test/report.ts`

Runs the generator + measurement across all scale points and variants, producing a markdown report.

- [ ] **Step 1: Create the report script**

`report.ts`:
```typescript
import { execSync } from 'child_process'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

const SCALE_POINTS = [50, 100, 150, 200, 250]
const VARIANTS = ['baseline', 'zod-mini'] as const
const MODES = ['tables-only', 'functions-only', 'both'] as const

interface ResultRow {
  variant: string
  mode: string
  count: number
  heapDeltaMB: string
  heapPeakMB: string
  modulesLoaded: number
  modulesFailed: number
  convexBaselineDeltaMB: string
  convexBaselinePeakMB: string  // Absolute peak for Convex-only — needed for 64MB claim
}

function run(cmd: string): string {
  console.log(`> ${cmd}`)
  return execSync(cmd, {
    cwd: join(import.meta.dir),
    encoding: 'utf-8',
    timeout: 120_000,
    env: { ...process.env, NODE_OPTIONS: '--expose-gc' },
  })
}

// Helper: write a temp measurement script and run it in an isolated process.
// This avoids module caching issues between zod and zod-mini.
function measureImportBaseline(pkg: string): string {
  const script = `
    import v8 from 'v8';
    globalThis.gc();
    const before = v8.getHeapStatistics().used_heap_size;
    await import('${pkg}');
    globalThis.gc();
    const after = v8.getHeapStatistics().used_heap_size;
    console.log(JSON.stringify({delta: after - before, mb: ((after-before)/1024/1024).toFixed(2)}));
  `
  return run(`bun --expose-gc -e "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`)
}

async function main() {
  const resultsDir = join(import.meta.dir, 'results')
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true })

  const rows: ResultRow[] = []

  // Run import baselines in isolated processes (ESM dynamic import, not require).
  // Parse the JSON output so we can persist it in the report.
  console.log('=== Measuring zod import baseline ===')
  const zodBaselineRaw = measureImportBaseline('zod')
  const zodImportBaseline = JSON.parse(zodBaselineRaw.trim()) as { delta: number; mb: string }
  console.log(`zod import: +${zodImportBaseline.mb} MB`)

  console.log('=== Measuring zod/mini import baseline ===')
  const miniBaselineRaw = measureImportBaseline('zod/mini')
  const miniImportBaseline = JSON.parse(miniBaselineRaw.trim()) as { delta: number; mb: string }
  console.log(`zod/mini import: +${miniImportBaseline.mb} MB`)

  // Persist baselines to a JSON file for the decision document
  writeFileSync(
    join(resultsDir, 'import-baselines.json'),
    JSON.stringify({ zodImportBaseline, miniImportBaseline }, null, 2)
  )

  for (const scale of SCALE_POINTS) {
    for (const variant of VARIANTS) {
      for (const mode of MODES) {
        console.log(`\n=== ${variant} / ${mode} / ${scale} ===`)

        // Generate
        run(`bun run generate.ts --count=${scale} --mode=${mode} --variant=${variant}`)

        // Measure — may throw if modules fail to import (e.g., zod-mini API gaps)
        try {
          run(`bun --expose-gc run measure.ts --count=${scale} --mode=${mode} --variant=${variant}`)

          // Read result
          const resultFile = join(resultsDir, `${variant}-${mode}-${scale}.json`)
          if (existsSync(resultFile)) {
            const data = JSON.parse(readFileSync(resultFile, 'utf-8'))
            rows.push({
              variant,
              mode,
              count: scale,
              heapDeltaMB: data.result.heapDeltaMB,
              heapPeakMB: data.result.heapPeakMB,
              modulesLoaded: data.result.modulesLoaded,
              modulesFailed: data.result.modulesFailed,
              convexBaselineDeltaMB: data.convexBaseline?.heapDeltaMB ?? 'n/a',
              convexBaselinePeakMB: data.convexBaseline?.heapPeakMB ?? 'n/a',
            })
          }
        } catch (e) {
          // Record as FAILED — this variant has API compatibility issues at this scale
          console.error(`FAILED: ${variant}/${mode}/${scale} — ${(e as Error).message}`)
          rows.push({
            variant,
            mode,
            count: scale,
            heapDeltaMB: 'FAILED',
            heapPeakMB: 'FAILED',
            modulesLoaded: 0,
            modulesFailed: -1,  // Unknown — measurement aborted before counting
            convexBaselineDeltaMB: 'n/a',
            convexBaselinePeakMB: 'n/a',
          })
        }
      }
    }
  }

  // Generate markdown report
  const lines: string[] = [
    '# Zod v4 OOM Stress Test Results',
    '',
    `**Date:** ${new Date().toISOString().split('T')[0]}`,
    `**Scale points:** ${SCALE_POINTS.join(', ')}`,
    `**Variants:** ${VARIANTS.join(', ')}`,
    '',
    '## Import Baselines (memory floor before any user schemas)',
    '',
    `| Package | Heap Delta (MB) |`,
    `|---------|----------------|`,
    `| zod | ${zodImportBaseline.mb} |`,
    `| zod/mini | ${miniImportBaseline.mb} |`,
    '',
    '## Results',
    '',
    '| Variant | Mode | Count | Heap Delta (MB) | Peak Heap (MB) | Loaded/Failed | Convex-Only Delta (MB) | Convex-Only Peak (MB) |',
    '|---------|------|-------|----------------|---------------|--------------|----------------------|---------------------|',
    ...rows.map(r => {
      const loadCol = r.modulesFailed === -1 ? 'FAILED' : `${r.modulesLoaded}/${r.modulesFailed}`
      return `| ${r.variant} | ${r.mode} | ${r.count} | ${r.heapDeltaMB} | ${r.heapPeakMB} | ${loadCol} | ${r.convexBaselineDeltaMB} | ${r.convexBaselinePeakMB} |`
    }),
    '',
    '> FAILED = variant could not load all modules (API compatibility gaps). These rows have no valid',
    '> heap measurement. This is itself a finding: the variant needs dedicated templates or API adaptation.',
    '',
    '## Analysis',
    '',
    '_Fill in after reviewing results._',
    '',
    '## Key Questions Answered',
    '',
    '- [ ] Which allocation path dominates: tables or functions?',
    '- [ ] Does zod-mini reduce per-schema memory vs full zod?',
    '- [ ] What is the lazy loading upper bound (baseline - convex_only)?',
    '- [ ] What is the Convex-validator-only cost at scale?',
    '- [ ] At what scale point does baseline hit the ~64MB wall?',
  ]

  const reportPath = join(resultsDir, 'report.md')
  writeFileSync(reportPath, lines.join('\n'))
  console.log(`\nReport written to ${reportPath}`)
}

main().catch(console.error)
```

- [ ] **Step 2: Test the report script at small scale**

First, verify that generate + measure works standalone:
```bash
cd examples/stress-test
bun run generate.ts --count=10 --mode=both --variant=baseline
bun --expose-gc run measure.ts --count=10 --mode=both --variant=baseline
```
Expected: results/ directory populated with JSON and property count numbers visible.

Then run report.ts itself (temporarily edit SCALE_POINTS to `[10]` and MODES to `['both']` for speed):
```bash
cd examples/stress-test
bun run report.ts
```
Expected: `results/report.md` generated with import baselines table, results table, and `import-baselines.json` written. Verify the markdown renders correctly.

- [ ] **Step 3: Commit report script**

```bash
git add examples/stress-test/report.ts
git commit -m "feat(stress-test): add report script for cross-variant measurement"
```

---

## Task 7: Run the full measurement suite and analyze

This is the payoff task — run all measurements and produce the report that drives Phase 1 decisions.

- [ ] **Step 1: Run the full report**

```bash
cd examples/stress-test
bun run report.ts
```

This will take several minutes. It runs 2 variants × 3 modes × 5 scale points = 30 measurement runs (plus import baselines and convex-only controls).

Expected: `results/report.md` generated with all rows populated.

- [ ] **Step 2: Review property counts**

Check the console output from the measurement runs for the per-schema property count comparison between `z.object()` and `zm.object()`. Record in the report:
- If counts are similar → zod-mini shares the same allocation cost, Track B may not help
- If counts differ significantly → zod-mini is a viable mitigation path

- [ ] **Step 3: Analyze allocation attribution**

Compare `tables-only` vs `functions-only` vs `both` for each variant at the 200-endpoint scale point:
- If tables-only ≈ both → table registration dominates
- If functions-only ≈ both → function registration dominates
- If tables-only + functions-only ≈ both → both contribute roughly equally

- [ ] **Step 4: Derive lazy loading upper bound from Convex-only baseline**

At each scale point, compute `baseline_heap - convex_only_heap`. This is the maximum memory that lazy Zod schema creation could save (the Zod allocation overhead). If this number is large enough to bring the total under 64MB, Track A (lazy loading) is viable. If not, lazy loading alone won't solve the problem.

- [ ] **Step 5: Write the Phase 0 → Phase 1 decision document**

Based on the results, fill in the analysis section of `results/report.md` and write a brief decision document answering:
1. Which Phase 1 tracks to pursue (A, B, both, neither)
2. Expected memory improvement from each track
3. Effort estimate for each track

- [ ] **Step 6: Commit results and analysis**

```bash
git add examples/stress-test/results/
git commit -m "docs(stress-test): add Phase 0 measurement results and analysis"
```

---

## Task 8: Extract minimal repro for upstream

**Files:**
- The repro may be a gist or separate repo — this task prepares the content.

- [ ] **Step 1: Create a self-contained repro script**

Using the baseline variant at the scale point that first exceeds 64MB (or the highest if none exceed), create a standalone script that:
- Has no zodvex dependency (raw zod + convex, to isolate the issue)
- Can be run with `bun run repro.ts` or `npx tsx repro.ts`
- Prints the heap measurement clearly
- Documents what it demonstrates

- [ ] **Step 2: Test the repro script independently**

Run the repro in a clean directory with only zod and convex installed.
Expected: Reproduces the OOM or clearly shows memory approaching the 64MB limit.

- [ ] **Step 3: Post on get-convex/convex-backend#414**

Share the repro script and measurement results as a comment on the upstream issue.

- [ ] **Step 4: Reply to panzacoder/zodvex#49**

Post a comment on dan-myles' issue with:
- Summary of findings (where the wall is, what's causing it)
- What mitigations we're pursuing (based on Phase 0 results)
- Interim workarounds if any (e.g., reducing endpoint count, splitting deployments)

- [ ] **Step 5: Commit repro**

```bash
git add examples/stress-test/repro.ts
git commit -m "docs(stress-test): add standalone repro for upstream Convex issue"
```
