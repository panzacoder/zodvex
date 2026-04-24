// Black-box heap measurer.
// Imports a convex directory (schema.ts + endpoints), reports heap delta.
// Knows nothing about zodvex internals — if an import fails, that's a signal
// about the library code, not this script.

import { join, resolve } from 'path'
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
import v8 from 'v8'

type Flavor = 'zodvex' | 'convex'

interface MeasureConfig {
  dir: string
  runtime: 'zod' | 'mini'
  flavor: Flavor
  resultsFile?: string
}

export interface MeasureResult {
  dir: string
  runtime: string
  heapBefore: number
  heapAfter: number
  heapDelta: number
  heapDeltaMB: string
  heapPeakMB: string
  modulesLoaded: number
  modulesFailed: number
  timestamp: string
}

function forceGC() {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc()
  }
}

function getHeapUsed(): number {
  return v8.getHeapStatistics().used_heap_size
}

function parseArgs(): MeasureConfig {
  const args = process.argv.slice(2)
  const dir = args.find(a => a.startsWith('--dir='))?.split('=')[1]
  if (!dir) throw new Error('--dir=<path> is required')
  const runtime = (args.find(a => a.startsWith('--runtime='))?.split('=')[1] ?? 'zod') as 'zod' | 'mini'
  const flavor = (args.find(a => a.startsWith('--flavor='))?.split('=')[1] ?? 'zodvex') as Flavor
  const resultsFile = args.find(a => a.startsWith('--results='))?.split('=')[1]
  return { dir, runtime, flavor, resultsFile }
}

export async function measure(config: MeasureConfig): Promise<MeasureResult> {
  const dir = resolve(config.dir)
  const { runtime, flavor } = config

  if (!existsSync(dir)) {
    throw new Error(`Directory not found: ${dir}`)
  }

  // Pre-import runtime libraries to baseline them out.
  // Must match the imports the composed code uses so we measure only schema creation.
  if (flavor === 'convex') {
    await import('convex/server')
    await import('convex/values')
  } else if (runtime === 'mini') {
    await import('zod/mini')
    await import('zodvex/mini')
    await import('zodvex/mini/server')
  } else {
    await import('zod')
    await import('zodvex')
    await import('zodvex/server')
  }

  forceGC()
  forceGC()
  const heapBefore = getHeapUsed()

  // Import schema.ts if it exists
  const schemaPath = join(dir, 'schema.ts')
  if (existsSync(schemaPath)) {
    await import(schemaPath)
  }

  // Import all endpoint files
  let modulesLoaded = 0
  let modulesFailed = 0
  const endpointsDir = join(dir, 'endpoints')
  if (existsSync(endpointsDir)) {
    const files = readdirSync(endpointsDir).filter(f => f.endsWith('.ts')).sort()
    for (const file of files) {
      try {
        await import(join(endpointsDir, file))
        modulesLoaded++
      } catch (e) {
        modulesFailed++
        console.error(`FAILED: ${file}: ${(e as Error).message}`)
      }
    }
  }

  // Count schema modules too
  if (existsSync(schemaPath)) {
    const modelsDir = join(dir, 'models')
    if (existsSync(modelsDir)) {
      modulesLoaded += readdirSync(modelsDir).filter(f => f.endsWith('.ts')).length
    }
  }

  if (modulesFailed > 0) {
    throw new Error(
      `${modulesFailed}/${modulesFailed + modulesLoaded} modules failed to import. ` +
      `Measurement is invalid.`
    )
  }

  forceGC()
  forceGC()
  const heapAfter = getHeapUsed()

  const delta = heapAfter - heapBefore
  return {
    dir: config.dir,
    runtime,
    heapBefore,
    heapAfter,
    heapDelta: delta,
    heapDeltaMB: (delta / 1024 / 1024).toFixed(2),
    heapPeakMB: (heapAfter / 1024 / 1024).toFixed(2),
    modulesLoaded,
    modulesFailed: 0,
    timestamp: new Date().toISOString(),
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = parseArgs()
  const result = await measure(config)

  console.log(`${result.runtime} (${result.modulesLoaded} modules): +${result.heapDeltaMB} MB (peak: ${result.heapPeakMB} MB)`)

  if (config.resultsFile) {
    const dir = join(config.resultsFile, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(config.resultsFile, JSON.stringify(result, null, 2))
    console.log(`Result saved to ${config.resultsFile}`)
  }
}
