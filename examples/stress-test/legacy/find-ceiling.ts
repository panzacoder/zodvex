/**
 * Binary search for the OOM ceiling of each variant.
 *
 * Finds the maximum endpoint count that stays under 64 MB heap delta
 * for each of: baseline, baseline+slim, zod-mini, zod-mini+slim.
 *
 * Usage: bun run find-ceiling.ts [--budget=64]
 */
import { execSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const EXAMPLE_DIR = fileURLToPath(new URL('.', import.meta.url))
const RESULTS_DIR = join(EXAMPLE_DIR, 'results')

const BUDGET_MB = parseInt(
  process.argv.find(a => a.startsWith('--budget='))?.split('=')[1] ?? '64'
)

type Scenario = {
  name: string
  variant: 'baseline' | 'zod-mini'
  slim: boolean
}

const SCENARIOS: Scenario[] = [
  { name: 'zod', variant: 'baseline', slim: false },
  { name: 'zod + slim', variant: 'baseline', slim: true },
  { name: 'mini', variant: 'zod-mini', slim: false },
  { name: 'mini + slim', variant: 'zod-mini', slim: true },
]

function measure(variant: string, count: number, slim: boolean): number | null {
  const slimFlag = slim ? ' --slim' : ''
  try {
    execSync(
      `bun run generate.ts --count=${count} --mode=both --variant=${variant} --shared${slimFlag}`,
      { cwd: EXAMPLE_DIR, stdio: 'pipe', timeout: 60_000 }
    )
    const output = execSync(
      `bun --expose-gc run measure.ts --count=${count} --mode=both --variant=${variant} --results=${RESULTS_DIR}`,
      { cwd: EXAMPLE_DIR, encoding: 'utf-8', timeout: 120_000, env: { ...process.env, NODE_OPTIONS: '--expose-gc' } }
    )
    // Parse heap delta from the Schema Creation line, not the Convex baseline
    // Look for "variant (mode, count): +XX.XX MB (peak: YY.YY MB)"
    const match = output.match(/--- Schema Creation ---\n.+\+(\d+\.\d+) MB/)
    return match ? parseFloat(match[1]) : null
  } catch {
    return null // OOM or import failure
  }
}

function binarySearch(scenario: Scenario): { ceiling: number; heapMB: number } {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Searching ceiling for: ${scenario.name} (budget=${BUDGET_MB} MB)`)
  console.log('='.repeat(60))

  // Start with coarse search to find the ballpark
  let lo = 50
  let hi = 500
  let lastGood = 0
  let lastGoodHeap = 0

  // Coarse: step by 50 to find where we cross the budget
  for (let count = lo; count <= hi; count += 50) {
    const heap = measure(scenario.variant, count, scenario.slim)
    if (heap === null) {
      console.log(`  ${count}: FAILED (import error)`)
      hi = count
      break
    }
    console.log(`  ${count}: ${heap.toFixed(2)} MB`)
    if (heap <= BUDGET_MB) {
      lastGood = count
      lastGoodHeap = heap
    } else {
      hi = count
      break
    }
  }

  if (lastGood === 0) {
    return { ceiling: 0, heapMB: 0 }
  }

  // Fine: binary search between lastGood and hi
  lo = lastGood
  while (hi - lo > 5) {
    const mid = Math.round((lo + hi) / 2)
    const heap = measure(scenario.variant, mid, scenario.slim)
    if (heap === null || heap > BUDGET_MB) {
      console.log(`  ${mid}: ${heap?.toFixed(2) ?? 'FAILED'} MB (over)`)
      hi = mid
    } else {
      console.log(`  ${mid}: ${heap.toFixed(2)} MB (under)`)
      lo = mid
      lastGood = mid
      lastGoodHeap = heap
    }
  }

  // Final check at lo
  const finalHeap = measure(scenario.variant, lo, scenario.slim)
  if (finalHeap !== null && finalHeap <= BUDGET_MB) {
    lastGood = lo
    lastGoodHeap = finalHeap
  }

  console.log(`  → Ceiling: ${lastGood} endpoints @ ${lastGoodHeap.toFixed(2)} MB`)
  return { ceiling: lastGood, heapMB: lastGoodHeap }
}

async function main() {
  console.log(`OOM Ceiling Search — budget: ${BUDGET_MB} MB`)
  console.log(`Date: ${new Date().toISOString().split('T')[0]}`)

  const results: { name: string; ceiling: number; heapMB: number }[] = []

  for (const scenario of SCENARIOS) {
    const { ceiling, heapMB } = binarySearch(scenario)
    results.push({ name: scenario.name, ceiling, heapMB })
  }

  console.log('\n' + '='.repeat(60))
  console.log('RESULTS')
  console.log('='.repeat(60))
  console.log(`\n| Variant | Ceiling (endpoints) | Heap at ceiling (MB) |`)
  console.log(`|---------|--------------------|--------------------|`)
  for (const r of results) {
    console.log(`| ${r.name} | ${r.ceiling} | ${r.heapMB.toFixed(2)} |`)
  }
}

main().catch(console.error)
