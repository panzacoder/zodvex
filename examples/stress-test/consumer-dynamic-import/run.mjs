import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { auditBundle } from './audit.mjs'
import { generateCase } from './generate.mjs'
import { assertResult, parseGc, retainedBytes } from './oracle.mjs'
import { captureProvenance, sha256 } from '../memory/provenance.mjs'

const [backendDirectory, outputArgument] = process.argv.slice(2)
if (!backendDirectory || !outputArgument || process.versions.node.split('.')[0] !== '22' || process.versions.bun)
  throw new Error('Usage: Node 22 run.mjs DEDICATED_BACKEND_DIRECTORY NEW_OUTPUT_DIRECTORY')
const here = dirname(fileURLToPath(import.meta.url))
const stressRoot = resolve(here, '..')
const metadata = JSON.parse(readFileSync(join(backendDirectory, 'metadata.json'), 'utf8'))
if (new URL(metadata.url).hostname !== '127.0.0.1' || metadata.reuseIsolates !== false ||
    !metadata.flags.includes('--expose-gc') || !metadata.sourceRevision)
  throw new Error('Known official local backend with GC diagnostics and fresh isolates required')
const key = readFileSync(join(backendDirectory, 'admin-key'), 'utf8').trim()
const output = resolve(outputArgument)
mkdirSync(output)
const temporary = mkdtempSync(join(tmpdir(), 'zodvex-dynamic-import-'))
const backend = { sha256: metadata.sha256, sourceRevision: metadata.sourceRevision,
  flags: metadata.flags, reuseIsolates: metadata.reuseIsolates, target: 'dedicated loopback backend' }
const scrub = value => value.replaceAll(key, '[credential]').replaceAll(temporary, '[generated-project]')
  .replaceAll(resolve(backendDirectory), '[backend-directory]')
const env = { ...process.env, CONVEX_SELF_HOSTED_URL: metadata.url, CONVEX_SELF_HOSTED_ADMIN_KEY: key }
for (const name of ['CONVEX_DEPLOYMENT', 'CONVEX_DEPLOY_KEY']) delete env[name]
const sourceHashes = () => Object.fromEntries(readdirSync(here).filter(name => /\.(mjs|ts)$/.test(name)).sort()
  .map(name => [name, sha256(readFileSync(join(here, name)))]))
const provenance = captureProvenance()
const harnessHashes = sourceHashes()
const cases = [{ unused: 0, touched: 1 }, { unused: 16, touched: 1 }, { unused: 64, touched: 1 }, { unused: 64, touched: 8 }]
const manifest = { format: 'zodvex-consumer-dynamic-import-v1', runId: randomUUID(),
  startedAt: new Date().toISOString(), ...provenance, harnessHashes, backend,
  historicalSource: { pr: 84, head: '284e1e54af73c6932b01041b4c4f0850bac431b8', port: 'mechanism only; retired 750-model corpus not reused' },
  cases, width: 32, repeats: 3, maximumCalls: 60,
  shape: { profile: 'neutral-separate-module-codec-union-v1', topLevelFieldsPerModel: 32,
    nestedFieldsPerModel: 40, codecSitesPerModel: 32, schemaHelpers: true },
  scope: 'V8 action module loading with manual insert-schema decodeDoc/encodeDoc; no DB I/O, async registry integration, or query/mutation parity. Forced-GC retained object bytes exclude external memory and peak; no hosted capacity claim.' }
writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
const log = join(backendDirectory, 'backend-pty.log')
const rows = [], identities = new Set()
let calls = 0
const deadline = Date.now() + 180000
async function invoke(type, endpoint, args) {
  if (++calls > 60 || Date.now() > deadline) throw new Error('Bounded experiment budget exceeded')
  const startedAt = new Date().toISOString()
  const response = await fetch(`${metadata.url}/api/${type}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Convex ${key}` },
    body: JSON.stringify({ path: endpoint, args, format: 'json' }), signal: AbortSignal.timeout(20000),
  })
  const raw = await response.json()
  if (!response.ok) throw new Error(`HTTP transport failure: ${response.status}`)
  return { startedAt, completedAt: new Date().toISOString(), httpStatus: response.status, raw }
}
async function readGc(offset, required) {
  let excerpt = '', lastLength = -1, quiet = 0, records = []
  const deadline = Date.now() + 1500
  do {
    await new Promise(resolve => setTimeout(resolve, 30))
    excerpt = readFileSync(log).subarray(offset).toString()
    quiet = excerpt.length === lastLength ? quiet + 1 : 0
    lastLength = excerpt.length
    records = parseGc(excerpt)
  } while ((quiet < 3 || (required && records.length < 2)) && Date.now() < deadline)
  if (quiet < 3) throw new Error('Backend log did not become quiet')
  return { excerpt, records }
}
function cli(project, args) {
  const result = spawnSync(process.execPath, [join(stressRoot, 'node_modules/convex/bin/main.js'), ...args],
    { cwd: project, env, encoding: 'utf8', timeout: 45000 })
  if (result.error || result.signal) throw new Error('Convex CLI subprocess failed', { cause: result.error })
  return { status: result.status, stdout: scrub(result.stdout), stderr: scrub(result.stderr) }
}
try {
  for (const dimensions of cases) {
    const caseName = `unused-${dimensions.unused}-touched-${dimensions.touched}`
    const project = join(temporary, caseName), evidence = join(output, caseName)
    mkdirSync(evidence)
    const fixture = generateCase(project, dimensions)
    symlinkSync(join(stressRoot, 'node_modules'), join(project, 'node_modules'), 'dir')
    writeFileSync(join(evidence, 'fixture.json'), JSON.stringify(fixture, null, 2))
    const deployed = cli(project, ['dev', '--once', '--typecheck', 'enable', '--tail-logs', 'disable'])
    writeFileSync(join(evidence, 'deployment.json'), JSON.stringify(deployed, null, 2))
    if (deployed.status !== 0) throw new Error(`Local deployment failed for ${caseName}: ${deployed.stderr}`)
    const debug = cli(project, ['dev', '--once', '--typecheck', 'enable', '--debug-bundle-path', '.debug'])
    if (debug.status !== 0) throw new Error(`Bundle export failed for ${caseName}`)
    const bundle = auditBundle(join(project, '.debug'), join(evidence, 'emitted'), fixture)
    for (const file of Object.keys(fixture.sourceFiles)) {
      const target = join(evidence, 'source', file)
      mkdirSync(dirname(target), { recursive: true })
      cpSync(join(project, file), target)
    }
    cpSync(join(project, 'convex/_generated'), join(evidence, 'source/convex/_generated'), { recursive: true })
    const nonce = randomUUID()
    const canary = await invoke('query', 'canary:ready', { nonce })
    if (canary.raw.status !== 'success' || !isDeepStrictEqual(canary.raw.value, { nonce, ...dimensions, width: 32 }))
      throw new Error('Local deployment canary mismatch')
    writeFileSync(join(evidence, 'canary.json'), JSON.stringify(canary, null, 2))
    const kinds = ['static', 'dynamic', ...(dimensions.touched === 1 && dimensions.unused !== 16 ? ['helpers'] : [])]
    // Runtime selections are request data. The 8-model case spreads across the deployed graph.
    const tables = dimensions.touched === 1 ? [fixture.names[0]] :
      Array.from({ length: 8 }, (_, i) => fixture.names[Math.floor(i * (fixture.total - 1) / 7)])
    const planned = [
      ...kinds.map(kind => ({ kind, type: 'action', endpoint: `${kind}:probe`, gc: false, phase: 'unforced-canary', round: null })),
      ...['query', 'mutation'].flatMap(type => ['static', 'dynamic'].map(kind =>
        ({ kind, type, endpoint: `${kind}:${type}Probe`, gc: false, phase: 'runtime-control', round: null }))),
      ...Array.from({ length: 3 }, (_, round) => (round % 2 ? [...kinds].reverse() : kinds)
        .map(kind => ({ kind, type: 'action', endpoint: `${kind}:probe`, gc: true, phase: 'retained-heap', round }))).flat(),
    ]
    for (const plan of planned) {
      const id = randomUUID(), args = { nonce: id, tables, gc: plan.gc }
      const offset = readFileSync(log).length
      const result = await invoke(plan.type, plan.endpoint, args)
      const { excerpt, records } = await readGc(offset, plan.gc && result.raw.status === 'success')
      let failure = null, totalRetainedObjectBytes = null
      if (result.raw.status === 'success') {
        assertResult(result.raw.value, { kind: plan.kind, fixture, tables, nonce: id })
        if (plan.gc) {
          totalRetainedObjectBytes = retainedBytes(records)
          if (identities.has(records[0].identity)) throw new Error('Unexpected reused diagnostic isolate')
          identities.add(records[0].identity)
        }
      } else if (plan.phase === 'runtime-control' && plan.kind === 'dynamic' &&
        /dynamic module import unsupported/.test(result.raw.errorMessage)) failure = 'dynamic-import-unsupported'
      else throw new Error(`Unexpected ${plan.endpoint} result: ${JSON.stringify(result.raw)}`)
      const row = { id, caseName, ...dimensions, width: 32, ...plan, ...result,
        args, failure, valid: true, moduleSetHash: bundle.moduleSetHash, totalRetainedObjectBytes, gcRecords: records }
      appendFileSync(join(output, 'calls.jsonl'), JSON.stringify(row) + '\n')
      if (plan.gc) writeFileSync(join(evidence, `gc-${id}.txt`), scrub(excerpt))
      rows.push(row)
      console.log(JSON.stringify({ caseName, kind: plan.kind, phase: plan.phase, type: plan.type, round: plan.round,
        initialized: result.raw.value?.after.length, totalRetainedObjectBytes, failure }))
    }
  }
  const finalProvenance = captureProvenance()
  for (const name of ['versions', 'zodvexBuild', 'runtime', 'comparisonIdentity'])
    if (!isDeepStrictEqual(provenance[name], finalProvenance[name])) throw new Error(`Provenance changed: ${name}`)
  if (!isDeepStrictEqual(harnessHashes, sourceHashes())) throw new Error('Experiment source changed while collecting')
  const statistics = []
  for (const dimensions of cases) for (const kind of ['static', 'dynamic', 'helpers']) {
    const group = rows.filter(row => row.phase === 'retained-heap' && row.kind === kind && row.unused === dimensions.unused && row.touched === dimensions.touched)
    if (!group.length) continue
    const values = group.map(row => row.totalRetainedObjectBytes).sort((a, b) => a - b)
    if (values.length !== 3) throw new Error('Missing repeat')
    statistics.push({ ...dimensions, kind, repeats: 3, minimum: values[0], median: values[1], maximum: values[2],
      initialized: group.map(row => row.raw.value.after.length) })
  }
  writeFileSync(join(output, 'summary.json'), JSON.stringify({ format: manifest.format, valid: true,
    completedAt: new Date().toISOString(), calls, observations: rows.length,
    manifestSha256: sha256(readFileSync(join(output, 'manifest.json'))),
    callsSha256: sha256(readFileSync(join(output, 'calls.jsonl'))), statistics,
    runtimeControls: rows.filter(row => row.phase === 'runtime-control').map(row => ({ caseName: row.caseName,
      endpoint: row.endpoint, status: row.raw.status, failure: row.failure })),
  }, null, 2))
} finally { rmSync(temporary, { recursive: true, force: true }) }
console.log(`Evidence: ${output}`)
