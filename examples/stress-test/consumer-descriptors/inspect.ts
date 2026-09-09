import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { captureProvenance, sha256 } from '../memory/provenance.mjs'
import { here } from './generate'

const [fixtureArg, outputArg] = process.argv.slice(2)
if (!fixtureArg || !outputArg) throw new Error('Usage: bun consumer-descriptors/inspect.ts GENERATED_FIXTURE_DIR OUTPUT_DIR')
const fixture = resolve(fixtureArg), out = resolve(outputArg)
mkdirSync(out, { recursive: false })
const cli = resolve(here, '../../../packages/zodvex/dist/cli/index.js')
const reports = []
for (const kind of ['full', 'descriptor']) {
  const entry = join(fixture, `diagnostic-${kind}.ts`)
  const result = spawnSync('node', [cli, 'inspect-schema', entry], { encoding: 'utf8', timeout: 60000 })
  writeFileSync(join(out, `${kind}.stdout.json`), result.stdout ?? '')
  writeFileSync(join(out, `${kind}.stderr.log`), result.stderr ?? '')
  let parsed = null
  try { parsed = JSON.parse(result.stdout) } catch { /* Unsupported/failure stays explicit. */ }
  reports.push({ kind, exitCode: result.status, reportProduced: result.status === 0 && parsed !== null,
    entrySha256: sha256(readFileSync(entry)), stdoutSha256: sha256(result.stdout ?? ''), parsed })
}
writeFileSync(join(out, 'summary.json'), JSON.stringify({ ...captureProvenance(), node: spawnSync('node', ['--version'], { encoding: 'utf8' }).stdout.trim(),
  scope: 'Packaged inspect-schema; local Node import/heap proxy, not Convex retained memory. Descriptor entry is a diagnostic __zodTableMap adapter, not a Convex schema.', reports }, null, 2))
console.log(JSON.stringify(reports, null, 2))
if (reports.some(row => !row.reportProduced)) process.exitCode = 1
