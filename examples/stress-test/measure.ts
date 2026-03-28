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
  heapPeakMB: string
  modulesLoaded: number
  modulesFailed: number
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
