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

type Flavor = 'zodvex' | 'convex' | 'convex-helpers'

interface Flags {
  count?: number
  slim: boolean
  mini: boolean
  convex: boolean
  convexHelpers: boolean
  deploy: boolean
  budget: number
}

function parseFlags(): Flags {
  const args = process.argv.slice(2)
  return {
    count: args.find(a => a.startsWith('--count=')) ? parseInt(args.find(a => a.startsWith('--count='))!.split('=')[1]) : undefined,
    slim: args.includes('--slim'),
    mini: args.includes('--mini'),
    convex: args.includes('--convex'),
    convexHelpers: args.includes('--convex-helpers'),
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
}

function getVariants(flags: Flags): Variant[] {
  if (flags.convex) {
    return [{ name: 'convex (baseline)', flavor: 'convex', slim: false, mini: false }]
  }
  if (flags.convexHelpers) {
    return [{ name: 'convex-helpers/zod4', flavor: 'convex-helpers', slim: false, mini: false }]
  }
  if (flags.slim || flags.mini) {
    return [{ name: zodvexVariantName(flags.slim, flags.mini), flavor: 'zodvex', slim: flags.slim, mini: flags.mini }]
  }
  return [
    { name: 'convex (baseline)', flavor: 'convex', slim: false, mini: false },
    { name: 'convex-helpers/zod4', flavor: 'convex-helpers', slim: false, mini: false },
    { name: 'zod', flavor: 'zodvex', slim: false, mini: false },
    { name: 'zod + slim', flavor: 'zodvex', slim: true, mini: false },
    { name: 'mini', flavor: 'zodvex', slim: false, mini: true },
    { name: 'mini + slim', flavor: 'zodvex', slim: true, mini: true },
  ]
}

function zodvexVariantName(slim: boolean, mini: boolean): string {
  if (slim && mini) return 'mini + slim'
  if (slim) return 'zod + slim'
  if (mini) return 'mini'
  return 'zod'
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
    execSync(`bun run compose.ts --count=${count} --flavor=${variant.flavor} --output=${COMPOSED_DIR}`, {
      cwd: ROOT, stdio: 'pipe', timeout: 60_000,
    })

    // Compile if mini (zodvex flavor only — convex seeds have no zod to transform)
    let measureDir = COMPOSED_DIR
    if (variant.mini) {
      compileDirectory(COMPOSED_DIR, COMPILED_DIR)
      measureDir = COMPILED_DIR
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
    '| Variant | Max Endpoints | Heap at Ceiling (MB) |',
    '|---------|--------------|---------------------|',
  ]

  for (const r of results) {
    const ceilingPoint = r.points.find(p => p.count === r.ceiling)
    lines.push(`| ${r.variant} | ${r.ceiling} | ${ceilingPoint?.heapDeltaMB.toFixed(2) ?? 'n/a'} |`)
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
  console.log(`\n| Variant | Ceiling (endpoints) | Heap at ceiling (MB) |`)
  console.log(`|---------|--------------------|--------------------|`)
  for (const r of results) {
    const p = r.points.find(p => p.count === r.ceiling)
    console.log(`| ${r.variant} | ${r.ceiling} | ${p?.heapDeltaMB.toFixed(2) ?? 'n/a'} |`)
  }

  writeReport(results, flags.budget)
}

main().catch(console.error)
