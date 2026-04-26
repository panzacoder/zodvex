import { execSync } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, cpSync, rmSync } from 'fs'
import { transformCode, transformImports } from 'zod-to-mini'
import { Project } from 'ts-morph'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const COMPOSED_DIR = join(ROOT, 'convex', 'composed')
const COMPILED_DIR = join(ROOT, 'convex', 'compiled')
const RESULTS_DIR = join(ROOT, 'results')

// --- Flag Parsing ---

type Flavor = 'zodvex' | 'convex' | 'convex-helpers' | 'convex-helpers-zod3'

interface Flags {
  count?: number
  slim: boolean
  mini: boolean
  codegen: boolean
  convex: boolean
  convexHelpers: boolean
  convexHelpersZod3: boolean
  deploy: boolean
  budget: number
}

function parseFlags(): Flags {
  const args = process.argv.slice(2)
  return {
    count: args.find(a => a.startsWith('--count=')) ? parseInt(args.find(a => a.startsWith('--count='))!.split('=')[1]) : undefined,
    slim: args.includes('--slim'),
    mini: args.includes('--mini'),
    codegen: args.includes('--codegen'),
    convex: args.includes('--convex'),
    convexHelpers: args.includes('--convex-helpers'),
    convexHelpersZod3: args.includes('--convex-helpers-zod3'),
    deploy: args.includes('--deploy'),
    budget: parseInt(args.find(a => a.startsWith('--budget='))?.split('=')[1] ?? '64'),
  }
}

// --- Variant Definition ---

interface Variant {
  name: string
  flavor: Flavor
  slim: boolean
  mini: boolean
  codegen: boolean
}

function getVariants(flags: Flags): Variant[] {
  if (flags.convex) {
    return [{ name: 'convex (baseline)', flavor: 'convex', slim: false, mini: false, codegen: false }]
  }
  if (flags.convexHelpers) {
    return [{ name: 'convex-helpers/zod4', flavor: 'convex-helpers', slim: false, mini: false, codegen: false }]
  }
  if (flags.convexHelpersZod3) {
    return [{ name: 'convex-helpers/zod3', flavor: 'convex-helpers-zod3', slim: false, mini: false, codegen: false }]
  }
  if (flags.slim || flags.mini || flags.codegen) {
    return [{
      name: zodvexVariantName(flags.slim, flags.mini, flags.codegen),
      flavor: 'zodvex',
      slim: flags.slim,
      mini: flags.mini,
      codegen: flags.codegen,
    }]
  }
  return [
    { name: 'convex (baseline)', flavor: 'convex', slim: false, mini: false, codegen: false },
    { name: 'convex-helpers/zod3', flavor: 'convex-helpers-zod3', slim: false, mini: false, codegen: false },
    { name: 'convex-helpers/zod4', flavor: 'convex-helpers', slim: false, mini: false, codegen: false },
    { name: 'zod', flavor: 'zodvex', slim: false, mini: false, codegen: false },
    { name: 'zod + codegen', flavor: 'zodvex', slim: false, mini: false, codegen: true },
    { name: 'zod + slim', flavor: 'zodvex', slim: true, mini: false, codegen: false },
    { name: 'mini', flavor: 'zodvex', slim: false, mini: true, codegen: false },
    { name: 'mini + slim', flavor: 'zodvex', slim: true, mini: true, codegen: false },
  ]
}

function zodvexVariantName(slim: boolean, mini: boolean, codegen: boolean): string {
  const parts: string[] = []
  parts.push(mini ? 'mini' : 'zod')
  if (slim) parts.push('slim')
  if (codegen) parts.push('codegen')
  return parts.join(' + ')
}

// --- Compile (zod → mini) ---

function compileDirectory(srcDir: string, destDir: string): void {
  if (existsSync(destDir)) rmSync(destDir, { recursive: true })
  cpSync(srcDir, destDir, { recursive: true })

  const dirs = ['models', 'endpoints']
  for (const sub of dirs) {
    const dir = join(destDir, sub)
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir).filter(f => f.endsWith('.ts'))) {
      compileFile(join(dir, file))
    }
  }

  for (const file of ['schema.ts', 'functions.ts']) {
    const filePath = join(destDir, file)
    if (existsSync(filePath)) compileFile(filePath)
  }
}

function compileFile(filePath: string): void {
  const code = readFileSync(filePath, 'utf-8')
  const result = transformCode(code)
  let output = result.code

  const project = new Project({ useInMemoryFileSystem: true })
  const sf = project.createSourceFile('tmp.ts', output)
  transformImports(sf)
  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue()
    if (spec === 'zodvex' || spec === 'zodvex/core') imp.setModuleSpecifier('zodvex/mini')
    if (spec === 'zodvex/server') imp.setModuleSpecifier('zodvex/mini/server')
  }

  // If codemod introduced z.* calls (e.g. z.nullable()) but the file has no z import, add one
  const hasZImport = sf.getImportDeclarations().some(imp => {
    const named = imp.getNamedImports().map(n => n.getName())
    const defaultImport = imp.getDefaultImport()?.getText()
    return named.includes('z') || defaultImport === 'z'
  })
  if (!hasZImport && sf.getFullText().match(/\bz\./)) {
    sf.addImportDeclaration({ namedImports: ['z'], moduleSpecifier: 'zod/mini' })
  }

  output = sf.getFullText()

  writeFileSync(filePath, output)
}

// --- Measurement (subprocess) ---

interface MeasurePoint {
  variant: string
  count: number
  heapDeltaMB: number
  heapPeakMB: number
  modulesLoaded: number
}

function measureAtCount(count: number, variant: Variant): MeasurePoint | null {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    NODE_OPTIONS: '--expose-gc',
  }
  if (variant.slim) env.ZODVEX_SLIM = '1'
  else delete env.ZODVEX_SLIM

  const resultsFile = join(ROOT, '.measure-result.json')

  try {
    // Compose
    const codegenFlag = variant.codegen ? ' --with-codegen' : ''
    execSync(`bun run compose.ts --count=${count} --flavor=${variant.flavor}${codegenFlag} --output=${COMPOSED_DIR}`, {
      cwd: ROOT, stdio: 'pipe', timeout: 60_000,
    })

    // Compile if mini (zodvex flavor only — convex seeds have no zod to transform)
    let measureDir = COMPOSED_DIR
    if (variant.mini) {
      compileDirectory(COMPOSED_DIR, COMPILED_DIR)
      measureDir = COMPILED_DIR
    }

    // Run real `zodvex generate` so the push-time graph includes the
    // codegen-emitted `_zodvex/api.js` (which redeclares Zod schemas inline
    // for every function). This is what real codegen-using apps pay.
    if (variant.codegen) {
      const miniFlag = variant.mini ? ' --mini' : ''
      execSync(`bunx zodvex generate ${measureDir}${miniFlag}`, {
        cwd: ROOT, stdio: 'pipe', timeout: 120_000,
      })
    }

    // Measure in subprocess
    const runtime = variant.mini ? 'mini' : 'zod'
    execSync(
      `bun --expose-gc run measure.ts --dir=${measureDir} --runtime=${runtime} --flavor=${variant.flavor} --results=${resultsFile}`,
      { cwd: ROOT, encoding: 'utf-8', timeout: 120_000, env }
    )

    // Read structured result
    if (!existsSync(resultsFile)) return null
    const result = JSON.parse(readFileSync(resultsFile, 'utf-8'))

    return {
      variant: variant.name,
      count,
      heapDeltaMB: parseFloat(result.heapDeltaMB),
      heapPeakMB: parseFloat(result.heapPeakMB),
      modulesLoaded: result.modulesLoaded,
    }
  } catch (e) {
    console.error(`  ${count}: FAILED — ${(e as Error).message?.split('\n')[0]}`)
    return null
  }
}

// --- Ceiling Search ---

function findCeiling(variant: Variant, budget: number): { ceiling: number; points: MeasurePoint[] } {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Searching ceiling for: ${variant.name} (budget=${budget} MB)`)
  console.log('='.repeat(60))

  const points: MeasurePoint[] = []
  let lastGood = 0
  // Convex baseline has ~zero per-model overhead beyond validators — the
  // ceiling can be much higher than zodvex's, so probe further.
  const initialHi = variant.flavor === 'convex' ? 10_000 : 1000
  const step = variant.flavor === 'convex' ? 500 : 50
  let hi = initialHi

  // Coarse pass
  for (let count = step; count <= hi; count += step) {
    const point = measureAtCount(count, variant)
    if (!point) { hi = count; break }
    points.push(point)
    console.log(`  ${count}: ${point.heapDeltaMB.toFixed(2)} MB`)
    if (point.heapDeltaMB <= budget) {
      lastGood = count
    } else {
      hi = count
      break
    }
  }

  // If we exhausted the coarse range without overshooting, we can't pinpoint
  // a ceiling — report the largest passing count we saw.
  if (lastGood > 0 && lastGood === hi) {
    console.log(`  → Reached probe cap at ${lastGood} endpoints without exceeding ${budget} MB`)
    return { ceiling: lastGood, points }
  }

  if (lastGood === 0) return { ceiling: 0, points }

  // Fine pass: binary search
  let lo = lastGood
  while (hi - lo > 5) {
    const mid = Math.round((lo + hi) / 2)
    const point = measureAtCount(mid, variant)
    if (!point || point.heapDeltaMB > budget) {
      console.log(`  ${mid}: ${point?.heapDeltaMB.toFixed(2) ?? 'FAILED'} MB (over)`)
      if (point) points.push(point)
      hi = mid
    } else {
      console.log(`  ${mid}: ${point.heapDeltaMB.toFixed(2)} MB (under)`)
      points.push(point)
      lo = mid
      lastGood = mid
    }
  }

  const ceilingPoint = points.find(p => p.count === lastGood)
  console.log(`  → Ceiling: ${lastGood} endpoints @ ${ceilingPoint?.heapDeltaMB.toFixed(2) ?? '?'} MB`)

  return { ceiling: lastGood, points }
}

// --- Report ---

/**
 * Per-endpoint cost in KB, computed as the slope between the first and last
 * passing points so fixed overhead (runtime, functions.ts, etc.) is excluded.
 * This is the number that actually drives the ceiling — heap at the ceiling
 * itself is tautological (≈ budget by construction).
 */
function perEndpointKB(points: MeasurePoint[]): number | null {
  if (points.length < 2) return null
  const sorted = [...points].sort((a, b) => a.count - b.count)
  const a = sorted[0]
  const b = sorted[sorted.length - 1]
  if (b.count === a.count) return null
  return ((b.heapDeltaMB - a.heapDeltaMB) / (b.count - a.count)) * 1024
}

function writeReport(
  results: { variant: string; ceiling: number; points: MeasurePoint[] }[],
  budget: number
): void {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

  const lines: string[] = [
    '# Stress Test Report',
    '',
    `**Date:** ${new Date().toISOString().split('T')[0]}`,
    `**Budget:** ${budget} MB`,
    '',
    '## OOM Ceilings',
    '',
    '`per-endpoint` is the slope between the smallest and largest passing',
    'measurements — the incremental cost of adding one model. Heap at the',
    'ceiling itself is always ≈ budget by construction, so it\'s omitted here.',
    '',
    '| Variant | Max Endpoints | Per-endpoint (KB) |',
    '|---------|--------------|-------------------|',
  ]

  for (const r of results) {
    const perEp = perEndpointKB(r.points)
    lines.push(`| ${r.variant} | ${r.ceiling} | ${perEp !== null ? perEp.toFixed(1) : 'n/a'} |`)
  }

  lines.push('', '## All Measurements', '')
  lines.push('| Variant | Count | Heap Delta (MB) | Peak (MB) | Modules |')
  lines.push('|---------|-------|-----------------|-----------|---------|')

  for (const r of results) {
    const sorted = [...r.points].sort((a, b) => a.count - b.count)
    for (const p of sorted) {
      lines.push(`| ${p.variant} | ${p.count} | ${p.heapDeltaMB.toFixed(2)} | ${p.heapPeakMB.toFixed(2)} | ${p.modulesLoaded} |`)
    }
  }

  const reportPath = join(RESULTS_DIR, 'report.md')
  writeFileSync(reportPath, lines.join('\n'))
  console.log(`\nReport written to ${reportPath}`)

  writeFileSync(
    join(RESULTS_DIR, 'report.json'),
    JSON.stringify({ date: new Date().toISOString(), budget, results }, null, 2)
  )
}

// --- Main ---

async function main() {
  const flags = parseFlags()

  if (flags.deploy) {
    throw new Error(
      '--deploy mode is not yet implemented. ' +
      'It will use `npx convex deploy` to find the real Convex isolate ceiling.'
    )
  }

  const variants = getVariants(flags)

  console.log(`Stress Test Harness`)
  console.log(`Budget: ${flags.budget} MB`)
  console.log(`Variants: ${variants.map(v => v.name).join(', ')}`)

  if (flags.count !== undefined) {
    // Ad-hoc: single measurement
    for (const variant of variants) {
      const point = measureAtCount(flags.count, variant)
      if (point) {
        console.log(`${variant.name} @ ${flags.count}: ${point.heapDeltaMB.toFixed(2)} MB (peak: ${point.heapPeakMB.toFixed(2)} MB)`)
      }
    }
    return
  }

  // Ceiling search + report
  const results: { variant: string; ceiling: number; points: MeasurePoint[] }[] = []

  for (const variant of variants) {
    const { ceiling, points } = findCeiling(variant, flags.budget)
    results.push({ variant: variant.name, ceiling, points })
  }

  // Print summary
  console.log('\n' + '='.repeat(60))
  console.log('RESULTS')
  console.log('='.repeat(60))
  console.log(`\n| Variant | Ceiling (endpoints) | Per-endpoint (KB) |`)
  console.log(`|---------|--------------------|--------------------|`)
  for (const r of results) {
    const perEp = perEndpointKB(r.points)
    console.log(`| ${r.variant} | ${r.ceiling} | ${perEp !== null ? perEp.toFixed(1) : 'n/a'} |`)
  }

  writeReport(results, flags.budget)
}

main().catch(console.error)
