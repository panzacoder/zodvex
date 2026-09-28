// Experiment-only adapter of memory/local.mjs: same fresh-isolate GC validation.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { captureProvenance, sha256 } from '../memory/provenance.mjs'
import { generateFixture, here } from './generate'
import { bundleConsumer } from './bundle.mjs'
import { characterize } from './semantic'

const [backendDir, outputArg] = process.argv.slice(2)
if (!backendDir || !outputArg) throw new Error('Usage: bun consumer-descriptors/run.ts BACKEND_DIR NEW_OUTPUT_DIR')
const out = resolve(outputArg)
if (existsSync(out)) throw new Error('Output already exists; preserve evidence with a new directory')
const metadata = JSON.parse(readFileSync(join(backendDir, 'metadata.json'), 'utf8'))
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(metadata.url).hostname) || metadata.reuseIsolates !== false) {
  throw new Error('Dedicated loopback backend with fresh isolates required')
}
const key = readFileSync(join(backendDir, 'admin-key'), 'utf8').trim()
const log = join(backendDir, 'backend-pty.log')
mkdirSync(join(out, 'sources'), { recursive: true })
writeFileSync(join(out, 'calls.jsonl'), '')
const contract = await characterize()
writeFileSync(join(out, 'semantics.json'), JSON.stringify(contract, null, 2))
if (!contract.baselinePasses) throw new Error('Baseline correctness failed; no memory measurement allowed')
const experimentHashes = () => Object.fromEntries(readdirSync(here).filter(name => /\.(ts|mjs|json)$/.test(name)).sort()
  .map(name => [name, sha256(readFileSync(join(here, name)))]))
const provenance = captureProvenance()
const sourceHashes = experimentHashes()
const manifest = { format: 'zodvex-descriptor-consumer-experiment-v1', startedAt: new Date().toISOString(),
  contractStatus: contract.contractStatus, semanticMismatches: contract.mismatches,
  ...provenance, experimentSourceHashes: sourceHashes, metadata,
  historicalOrigin: JSON.parse(readFileSync(join(here, 'source-origin.json'), 'utf8')),
  counts: [0, 16, 64], width: 32, rounds: 3, plannedCalls: 18, touchedModels: 1,
  mode: 'static generated modules', diagnosticForcedGc: true,
  operationTarget: 'Current ZodvexDatabaseWriter wrapping a stateful in-memory DB contract inside a real local Convex query',
  scope: 'No deployed DB reads/writes; no hosted capacity conclusion. Retained V8 object bytes after forced GC, not external/peak memory. Failed compatibility prevents equivalent-consumer improvement claims.' }
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
const fixtureDirectories = new Map<number, string>()
for (const count of manifest.counts) {
  const path = join(out, 'fixtures', String(count))
  generateFixture(path, count, manifest.width)
  fixtureDirectories.set(count, path)
}
const cells = manifest.counts.flatMap(count => ['eager', 'descriptor'].map(kind => ({ count, kind })))
const observations: any[] = []
const collectionStarted = Date.now(), deadline = collectionStarted + 60000
let abort: string | null = null
try {
  for (let round = 0; round < 3; round++) for (const cell of round % 2 ? [...cells].reverse() : cells) {
    if (Date.now() > deadline) throw new Error('One-minute collection budget exceeded')
    const id = randomUUID()
    const bundled = await bundleConsumer(fixtureDirectories.get(cell.count), cell.kind, cell.count, id)
    const source = bundled.source
    writeFileSync(join(out, 'sources', `${id}.js`), source)
    const offset = readFileSync(log).length
    const startedAt = new Date().toISOString()
    const response = await fetch(metadata.url + '/api/run_test_function', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminKey: key, args: {}, bundle: { path: 'testQuery.js', source }, format: 'convex_encoded_json' }),
      signal: AbortSignal.timeout(Math.min(10000, Math.max(1, deadline - Date.now()))),
    })
    const raw = await response.json()
    let records: any[] = [], excerpt = '', lastLength = -1, quiet = 0
    const logDeadline = Date.now() + 1000
    do {
      await new Promise(resolve => setTimeout(resolve, 30))
      excerpt = readFileSync(log).subarray(offset).toString()
      quiet = excerpt.length === lastLength ? quiet + 1 : 0
      lastLength = excerpt.length
      records = excerpt.split('\n').flatMap(line => {
        const at = line.indexOf('GC: {')
        if (at < 0) return []
        try {
          const gc = JSON.parse(line.slice(at + 4).trim())
          return gc.reason === 'testing' ? [{ identity: line.slice(0, at).match(/^\[[^\]]+\]/)?.[0], ...gc }] : []
        } catch { return [] }
      })
    } while ((records.length < 2 || quiet < 3) && Date.now() < logDeadline)
    const expectedNames = ['probe', ...Array.from({ length: cell.count }, (_, i) => `unused${i}`)].sort()
    const expectedOperation = contract.operations[cell.kind === 'eager' ? 'full' : 'descriptor']
    const result = raw.value
    const checks = {
      http: response.ok, query: raw.status === 'success', nonce: result?.nonce === id,
      dimensions: result?.count === cell.count && result?.kind === cell.kind,
      operations: isDeepStrictEqual(result?.operation, expectedOperation),
      tables: isDeepStrictEqual(result?.tables, expectedNames),
      checksum: result?.checksum === expectedNames.reduce((sum, name) => sum + name.length, 0),
      modelInitializations: isDeepStrictEqual([...result?.models ?? []].sort(), cell.kind === 'eager' ? expectedNames : []),
      descriptorInitializations: isDeepStrictEqual([...result?.descriptors ?? []].sort(), cell.kind === 'descriptor' ? expectedNames : []),
      gc: records.length >= 2 && quiet >= 3 && records.every(row => row.identity && row.gc === 'mc' && Number.isFinite(row.end_object_size) && row.end_object_size > 0) && new Set(records.map(row => row.identity)).size === 1,
    }
    const valid = Object.values(checks).every(Boolean)
    const row = { id, ...cell, round, startedAt, completedAt: new Date().toISOString(),
      valid, checks, contractStatus: contract.contractStatus, totalRetainedObjectBytes: valid ? records.at(-1).end_object_size : null,
      bundleHash: sha256(source), bundleBytes: Buffer.byteLength(source), inputs: bundled.inputs,
      modelInputs: bundled.modelInputs, descriptorInputs: bundled.descriptorInputs,
      status: response.status, raw, gc: records }
    appendFileSync(join(out, 'calls.jsonl'), JSON.stringify(row) + '\n')
    writeFileSync(join(out, `gc-${id}.log`), excerpt)
    observations.push(row)
    console.log(JSON.stringify({ kind: cell.kind, count: cell.count, round, valid, bytes: row.totalRetainedObjectBytes, failedChecks: Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => name) }))
    if (!valid) throw new Error('Invalid local Convex observation; raw evidence retained')
  }
  const finalProvenance = captureProvenance()
  for (const key of ['zodvexBuild', 'versions', 'runtime', 'comparisonIdentity'] as const) {
    if (!isDeepStrictEqual(provenance[key], finalProvenance[key])) throw new Error(`${key} changed during collection`)
  }
  if (!isDeepStrictEqual(sourceHashes, experimentHashes())) throw new Error('Experiment sources changed during collection')
} catch (error) { abort = String(error) }
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const summary = { contractStatus: contract.contractStatus, validMeasurement: !abort && observations.length === 18,
  abort, observedCalls: observations.length, plannedCalls: 18, collectionMilliseconds: Date.now() - collectionStarted,
  manifestSha256: sha256(readFileSync(join(out, 'manifest.json'))), callsSha256: sha256(readFileSync(join(out, 'calls.jsonl'))),
  cells: cells.map(cell => {
    const values = observations.filter(row => row.kind === cell.kind && row.count === cell.count && row.valid)
    const deltas = values.map(row => row.totalRetainedObjectBytes - observations.find(control => control.kind === cell.kind && control.count === 0 && control.round === row.round)?.totalRetainedObjectBytes)
    return { ...cell, samples: values.length, retainedBytes: values.map(row => row.totalRetainedObjectBytes),
      medianRetainedBytes: median(values.map(row => row.totalRetainedObjectBytes)), deltaBytesFromPairedZero: deltas, medianDeltaBytes: median(deltas) }
  }) }
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
if (!summary.validMeasurement) process.exitCode = 1
