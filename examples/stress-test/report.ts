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
  convexBaselinePeakMB: string
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
            modulesFailed: -1,
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
