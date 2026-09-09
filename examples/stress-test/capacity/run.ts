import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { composeCapacity, variants } from './compose.js'
import { auditGraph } from './graph.js'
import { assessValidity, classifyFailure, parseCompletion, summarize, type CapacityCompletion } from './measurements.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const project = join(root, '_deploy')
const cli = realpathSync(join(root, 'node_modules/.bin/convex'))
const options = new Map(process.argv.slice(2).map(arg => {
  const [key, ...value] = arg.replace(/^--/, '').split('=')
  return [key, value.join('=')]
}))
for (const key of options.keys()) if (!['help', 'deployment', 'rounds', 'batches', 'payload-bytes', 'seed', 'output'].includes(key)) throw new Error(`Unknown option --${key}`)
if (options.has('help')) {
  console.log('bun run capacity --deployment=<dedicated-dev-slug> [--rounds=7] [--batches=1,64,256] [--payload-bytes=640] [--seed=42] [--output=<directory>]')
  console.log('Pushes a fixed benchmark app to the named development deployment; seeds only synthetic benchmarkRows. Requires existing Convex CLI login. Never point it at a consumer app.')
  process.exit(0)
}
const deployment = options.get('deployment')
if (!deployment || !/^[a-z]+-[a-z]+-\d+$/.test(deployment)) throw new Error('An explicit dedicated --deployment=<slug> is required')
for (const key of ['CONVEX_DEPLOY_KEY', 'CONVEX_SELF_HOSTED_URL', 'CONVEX_SELF_HOSTED_ADMIN_KEY']) {
  if (process.env[key]) throw new Error(`Unset ${key}; it can override the explicit deployment selection`)
}
const rounds = Number(options.get('rounds') || 7)
const batches = (options.get('batches') || '1,64,256').split(',').map(Number)
const payloadBytes = Number(options.get('payload-bytes') || 640)
const seed = Number(options.get('seed') || 42)
if (!Number.isInteger(rounds) || rounds < 3 || rounds > 15) throw new Error('rounds must be 3..15')
if (!batches.length || new Set(batches).size !== batches.length || batches.some(n => !Number.isInteger(n) || n < 1 || n > 8192)) throw new Error('batches must be distinct integers in 1..8192')
if (!Number.isInteger(payloadBytes) || payloadBytes < 0 || payloadBytes > 2048) throw new Error('payload-bytes must be 0..2048')
if (!Number.isSafeInteger(seed)) throw new Error('seed must be an integer')
const calls = variants.length * (batches.length * rounds + 1)
if (calls > 512) throw new Error('The run exceeds the 512 sample-call budget; reduce rounds or batches')

const run = randomUUID()
const output = resolve(options.get('output') || join(root, 'results/local', `capacity-${run}`))
if (existsSync(output)) throw new Error('Output already exists; use a new directory to preserve prior results')
mkdirSync(output, { recursive: true })
const source = join(root, 'tmp', `capacity-${run}`)
const fixture = composeCapacity(source)
const convexDirectory = join(project, 'convex')
mkdirSync(convexDirectory, { recursive: true })
for (const name of readdirSync(convexDirectory)) {
  if (!['_generated', 'convex.config.ts'].includes(name)) rmSync(join(convexDirectory, name), { recursive: true, force: true })
}
cpSync(source, convexDirectory, { recursive: true })
const git = (args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim()
const versions = Object.fromEntries(['convex', 'convex-helpers', 'zod', 'zodvex'].map(name => [name, JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).version]))
const metadata = {
  run, startedAt: new Date().toISOString(), deployment, url: `https://${deployment}.convex.cloud`,
  gitCommit: git(['rev-parse', 'HEAD']), gitStatus: git(['status', '--short']), versions,
  runner: { nodeCompatibility: process.version, bun: process.versions.bun ?? null, cliNode: spawnSync('node', ['--version'], { encoding: 'utf8' }).stdout.trim(), executable: process.execPath, platform: process.platform, arch: process.arch },
  rounds, batches, payloadBytes, seed, sampleCallBudget: calls, fixture,
  telemetry: 'Server Completion records; memoryUsedMb is a configured allowance and is not reported as measured heap. No cold-isolate indicator is available.',
}
writeFileSync(join(output, 'manifest.json'), JSON.stringify(metadata, null, 2))

async function command(args: string[]) {
  const child = spawn(cli, args, { cwd: project, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  const log = join(output, 'setup.log')
  child.stdout.on('data', data => appendFileSync(log, data))
  child.stderr.on('data', data => appendFileSync(log, data))
  const timer = setTimeout(() => child.kill('SIGTERM'), 180000)
  const code = await new Promise<number | null>((accept, reject) => { child.on('error', reject); child.on('close', accept) })
  clearTimeout(timer)
  if (code !== 0) throw new Error(`Convex setup failed (${code}); inspect ${log}`)
}
console.log(`Preparing one fixed app and ${Math.max(...batches)} synthetic rows on ${deployment}; ${calls} sample calls maximum.`)
await command(['run', '--push', '--typecheck', 'enable', '--deployment-name', deployment, 'driver:prepare', JSON.stringify({ count: Math.max(...batches), payloadBytes })])
await auditGraph(convexDirectory, output)

const completions = new Map<string, CapacityCompletion>()
let pending = ''
let logError: string | null = null
let stoppingCollector = false
const queryPath = (name: string) => name === 'native' ? 'native:read' : `${name}/query:read`
const queryPaths = new Set(variants.map(v => queryPath(v.name)))
const logs = spawn(cli, ['logs', '--jsonl', '--history', '1000', '--deployment-name', deployment], { cwd: project, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
logs.on('error', error => { logError = error.message })
logs.on('close', code => { if (!stoppingCollector) logError = `Collector exited unexpectedly (${code})` })
logs.stderr.on('data', data => appendFileSync(join(output, 'collector.log'), data))
logs.stdout.on('data', data => {
  pending += data.toString()
  let newline: number
  while ((newline = pending.indexOf('\n')) !== -1) {
    const line = pending.slice(0, newline)
    pending = pending.slice(newline + 1)
    try {
      const raw: unknown = JSON.parse(line)
      const event = parseCompletion(raw)
      if (event?.run === run && queryPaths.has(event.identifier)) {
        const previous = completions.get(event.sample)
        if (previous && previous.executionId !== event.executionId) logError = `Multiple executions for sample ${event.sample}`
        completions.set(event.sample, event)
        appendFileSync(join(output, 'completions.jsonl'), JSON.stringify(event.raw) + '\n')
      } else if (!event && raw && typeof raw === 'object' && 'kind' in raw && raw.kind === 'Completion'
        && 'identifier' in raw && typeof raw.identifier === 'string' && queryPaths.has(raw.identifier)
        && 'timestamp' in raw && typeof raw.timestamp === 'number' && raw.timestamp * 1000 >= Date.parse(metadata.startedAt)) {
        // Module initialization can fail before our marker. Preserve evidence without
        // guessing which sample it belongs to; missing attribution invalidates the run.
        appendFileSync(join(output, 'unattributed-completions.jsonl'), JSON.stringify(raw) + '\n')
      }
    } catch { /* CLI status lines are not completion records. Missing telemetry is checked below. */ }
  }
})

type Observation = {
  sample: string; variant: string; limit: number; round: number; phase: 'initial' | 'measured';
  driverElapsedMs: number; result: unknown; failure: string | null; error: string | null;
  failureSource?: 'query' | 'driver' | 'unknown' | null;
  completion?: CapacityCompletion | null;
}
const observations: Observation[] = []
let randomState = seed >>> 0
function shuffle<T>(input: readonly T[]): T[] {
  const copy = [...input]
  for (let i = copy.length - 1; i > 0; i--) {
    randomState = (Math.imul(1664525, randomState) + 1013904223) >>> 0
    const j = Math.floor((randomState / 4294967296) * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}
const client = new ConvexHttpClient(metadata.url, {
  logger: false,
  fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20000) }),
})
const ref = makeFunctionReference<'action'>('driver:sample')
const reference = makeFunctionReference<'action', { limit: number }, string>('driver:reference')
const identities = new Map<number, string>()
const deadline = Date.now() + 5 * 60 * 1000
async function sample(variant: string, limit: number, round: number, phase: Observation['phase']) {
  if (Date.now() > deadline) throw new Error('Benchmark exceeded the five-minute sampling budget')
  const id = `${phase}-${observations.length}`
  const start = performance.now()
  let result: unknown = null
  let error: string | null = null
  try {
    result = await client.action(ref, { variant, limit, run, sample: id, payloadBytes })
    if (!result || typeof result !== 'object' || !('identityHash' in result) || result.identityHash !== identities.get(limit)) {
      throw new Error('HARNESS: returned document identities differ from the independent database reference')
    }
  }
  catch (caught) { error = caught instanceof Error ? caught.message : String(caught) }
  const observation: Observation = { sample: id, variant, limit, round, phase, driverElapsedMs: performance.now() - start, result, failure: error ? classifyFailure(error) : null, error }
  observations.push(observation)
  appendFileSync(join(output, 'calls.jsonl'), JSON.stringify(observation) + '\n')
  if (error) console.log(`${variant} n=${limit}: ${observation.failure}`)
}

try {
  for (const limit of batches) identities.set(limit, await client.action(reference, { limit }))
  writeFileSync(join(output, 'identity-reference.json'), JSON.stringify(Object.fromEntries(identities), null, 2))
  for (const variant of shuffle(variants)) await sample(variant.name, Math.min(...batches), -1, 'initial')
  // Serial, seeded, interleaved rounds avoid load-test concurrency and fixed variant order.
  const cells = variants.flatMap(v => batches.map(limit => ({ variant: v.name, limit })))
  for (let round = 0; round < rounds; round++) {
    for (const cell of shuffle(cells)) await sample(cell.variant, cell.limit, round, 'measured')
    console.log(`Round ${round + 1}/${rounds}: ${observations.length} calls completed.`)
  }
  const collectorDeadline = Date.now() + 15000
  while (observations.some(o => !completions.has(o.sample)) && !logError && Date.now() < collectorDeadline) await new Promise(resolve => setTimeout(resolve, 250))
} catch (error) {
  logError = `Run aborted: ${error instanceof Error ? error.message : String(error)}`
} finally {
  stoppingCollector = true
  logs.kill('SIGTERM')
}
for (const observation of observations) {
  const completion = completions.get(observation.sample) ?? null
  observation.completion = completion
  if (completion && (completion.identifier !== queryPath(observation.variant) || completion.limit !== observation.limit)) logError = 'Completion does not match the dispatched query/limit'
  observation.failureSource = completion?.error ? 'query' : observation.error ? completion ? 'driver' : 'unknown' : null
  observation.failure = completion?.error ? classifyFailure(completion.error)
    : observation.error ? completion ? 'harness' : classifyFailure(observation.error) : null
}
const measured = observations.filter(o => o.phase === 'measured')
const summaries = variants.flatMap(variant => batches.map(limit => {
  const group = measured.filter(o => o.variant === variant.name && o.limit === limit)
  const usable = group.filter(o => !o.error && !o.completion?.error && o.completion?.cachedResult === false && o.completion.executionMs !== null)
  const ratios = usable.flatMap(o => {
    const baseline = measured.find(b => b.variant === 'native' && b.limit === limit && b.round === o.round)
    const ms = baseline?.completion?.executionMs
    return baseline && !baseline.error && !baseline.completion?.error && baseline.completion?.cachedResult === false && ms && o.completion?.executionMs !== null
      ? [o.completion!.executionMs! / ms] : []
  })
  return {
    variant: variant.name, rows: limit, attempts: group.length, successes: group.filter(o => !o.error).length,
    missingTelemetry: group.filter(o => !o.completion).length,
    cacheHits: group.filter(o => o.completion?.cachedResult === true).length,
    failureClasses: group.filter(o => o.failure).map(o => o.failure),
    executionMs: summarize(usable.map(o => o.completion!.executionMs!)),
    userExecutionMs: summarize(usable.flatMap(o => o.completion!.userExecutionMs === null ? [] : [o.completion!.userExecutionMs!])),
    pairedNativeRatio: summarize(ratios),
    readBytes: summarize(usable.flatMap(o => o.completion?.readBytes === null ? [] : [o.completion!.readBytes!])),
    returnedBytes: summarize(usable.flatMap(o => o.completion?.returnBytes === null ? [] : [o.completion!.returnBytes!])),
  }
}))
const validity = assessValidity(observations, calls, logError)
const report = { ...metadata, completedAt: new Date().toISOString(), validity, logError, observations, summaries }
writeFileSync(join(output, 'results.json'), JSON.stringify(report, null, 2))
const number = (value: number | null) => value === null ? 'unavailable' : value.toFixed(2)
writeFileSync(join(output, 'report.md'), `# Zodvex codec workload benchmark

**${validity.valid ? 'VALID: complete observations and attributable capacity outcomes.' : 'INVALID: do not use this run for comparative performance claims.'}**

${validity.reasons.map(reason => `- ${reason}`).join('\n')}

Run ${run}; library commit ${metadata.gitCommit}; fixture ${fixture.fixtureHash}.

Started ${metadata.startedAt}; target ${deployment}. Payload field: ${payloadBytes} ASCII bytes; seeded rows: ${Math.max(...batches)}; batch sizes: ${batches.join(', ')}; rounds: ${rounds}; order seed: ${seed}. Payload is not full document size; actual resource counts are in results.json.

All variants use one model. Native/helpers and lean import one; models/registry import 32. Registry profiles additionally load 128 unused schema entries. These counts describe this synthetic fixture, not typical applications.

${JSON.stringify(versions)}

One indexed read, modeled decode, domain transform and complete return encoding. Driver correctness checking and client transport are outside query execution time. Native performs manual codec transforms, without full Zod modeled validation. No measured heap or true cold-start claim.

${observations.length}/${calls} planned calls recorded, including initial calls. All phases are checked for validity; the table below excludes initial calls. Named query capacity failures are outcomes; correctness, collection and attribution failures invalidate the run.

| Variant | Rows | Verified calls | Timing samples / planned | Missing telemetry | Cache hits | Server ms median [Q1, Q3] | User ms median | Paired native ratio | Errors |
|---|---:|---:|---:|---:|---:|---|---:|---:|---|
${summaries.map(s => `| ${s.variant} | ${s.rows} | ${s.successes}/${s.attempts} | ${s.executionMs.count}/${rounds} | ${s.missingTelemetry} | ${s.cacheHits} | ${number(s.executionMs.median)} [${number(s.executionMs.q1)}, ${number(s.executionMs.q3)}] | ${number(s.userExecutionMs.median)} | ${number(s.pairedNativeRatio.median)} | ${s.failureClasses.join(', ') || 'none'} |`).join('\n')}

The largest tested successful batch is a lower bound under this fixture, not a maximum or a general row/table allowance. Timings describe successful uncached samples only; they do not conceal failed attempts shown alongside them. Full failure text/source, resource counters, optional user-timer sample counts, and exact call order are retained in results.json.
`)

console.log(`Results: ${join(output, 'report.md')}`)
if (!validity.valid) {
  console.error(`Invalid benchmark run: ${validity.reasons.join('; ')}`)
  process.exitCode = 1
}
