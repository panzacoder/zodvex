// Local schema-construction proxy. No Convex deployment or capacity inference.
// node schemaBaseline.mjs <zod-4.3.6-package-directory> <zod-4.5.4-package-directory>
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const file = fileURLToPath(import.meta.url)
const count = 300
const repetitions = 5

if (process.argv[2] === '--child') {
  if (!globalThis.gc) throw new Error('Requires --expose-gc')
  const directory = process.argv[3]
  const { z } = await import(pathToFileURL(join(directory, 'index.js')).href)
  const version = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).version
  const model = () => z.object({
    title: z.string(),
    description: z.string().optional(),
    score: z.number(),
    active: z.boolean(),
    status: z.union([z.literal('new'), z.literal('active'), z.literal('done')]),
    profile: z.object({ name: z.string(), age: z.number().optional() }),
    tags: z.array(z.string()),
    category: z.enum(['a', 'b', 'c']),
    priority: z.number().default(0),
    parent: z.string().nullable(),
  })
  const sample = { title: 'task', score: 1, active: true, status: 'new',
    profile: { name: 'person' }, tags: ['tag'], category: 'a', parent: null }
  // Warm each process equally; timed construction excludes import and warmup.
  for (let i = 0; i < 20; i++) model().parse(sample)
  const heap = () => { globalThis.gc(); globalThis.gc(); return process.memoryUsage().heapUsed }
  const beforeBytes = heap()
  const started = performance.now()
  const schemas = Array.from({ length: count }, model)
  const constructionMs = performance.now() - started
  const constructedBytes = heap()
  for (const schema of schemas) schema.parse(sample)
  const parsedBytes = heap()
  // Read after GC to keep the schemas reachable through the final measurement.
  if (schemas.length !== count) throw new Error('Lost retained schema set')
  console.log(JSON.stringify({ version, count, constructionMs, beforeBytes,
    constructedBytes, parsedBytes, retainedConstructionBytes: constructedBytes - beforeBytes,
    retainedAfterParseBytes: parsedBytes - beforeBytes }))
} else {
  const directories = process.argv.slice(2).map((p) => resolve(p))
  if (directories.length !== 2) throw new Error('Provide package directories for Zod 4.3.6 and 4.5.4, in that order')
  for (const [i, expected] of ['4.3.6', '4.5.4'].entries()) {
    const actual = JSON.parse(readFileSync(join(directories[i], 'package.json'), 'utf8')).version
    if (actual !== expected) throw new Error(`Expected ${expected}, found ${actual}`)
  }
  const rows = []
  // Alternate order to reduce systematic ordering effects; fresh process per sample.
  for (let repetition = 0; repetition < repetitions; repetition++) {
    const order = repetition % 2 === 0 ? directories : [...directories].reverse()
    for (const directory of order) {
      rows.push({ repetition, ...JSON.parse(execFileSync(process.execPath,
        ['--expose-gc', file, '--child', directory], { encoding: 'utf8' })) })
    }
  }
  const git = (...args) => execFileSync('git', args, { cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8' }).trim()
  console.log(JSON.stringify({
    kind: 'local-schema-construction-proxy-v1',
    timestamp: new Date().toISOString(),
    node: process.version, v8: process.versions.v8, platform: process.platform,
    arch: process.arch, cpu: cpus()[0]?.model, count, repetitions,
    gitSha: git('rev-parse', 'HEAD'), gitDirty: git('status', '--porcelain') !== '',
    scriptSha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    scope: 'Retained Node heap and construction time only; not Convex deployment capacity, function latency, or a validation guarantee.',
    rows,
  }, null, 2))
}
