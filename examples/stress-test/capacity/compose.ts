import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const variants = [
  { name: 'native', implementation: 'native manual transforms', models: 1, entries: 0 },
  { name: 'helpers', implementation: 'helpers + explicit DB/reverse return codecs', models: 1, entries: 0 },
  ...(['full', 'mini'] as const).flatMap(kind => [
    { name: `${kind}_lean`, implementation: kind, models: 1, entries: 0 },
    { name: `${kind}_models`, implementation: kind, models: 32, entries: 0 },
    { name: `${kind}_registry`, implementation: kind, models: 32, entries: 128 },
  ]),
]

const here = dirname(fileURLToPath(import.meta.url))
const wireFields = `{
  seq: v.number(), createdAt: v.number(), secret: v.string(), payload: v.string(),
  tags: v.array(v.string()), checkpoints: v.array(v.object({ at: v.number(), value: v.number() })),
  reviewedAt: v.optional(v.union(v.number(), v.null())),
}`
const tableName = (index: number) => index === 0 ? 'benchmarkRows' : `unused${index}`

/** A fixed app, not a deploy-until-failure sweep. Each case is a separate import graph. */
export function composeCapacity(destination: string) {
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  const files: Record<string, string> = {}
  const put = (path: string, source: string) => { files[path] = source }
  put('tsconfig.json', JSON.stringify({ compilerOptions: {
    target: 'ESNext', module: 'ESNext', moduleResolution: 'Bundler', strict: true,
    skipLibCheck: true, noEmit: true, allowJs: true, lib: ['ESNext', 'DOM'], types: [],
  }, include: ['./**/*.ts'] }, null, 2))
  put('workload.ts', readFileSync(join(here, 'workload.ts'), 'utf8'))
  put('wire.ts', `import { v } from 'convex/values'
export const fields = ${wireFields}
export const doc = v.object({ ...fields, _id: v.id('benchmarkRows'), _creationTime: v.number() })
export const args = { limit: v.number(), run: v.string(), sample: v.string() }
export const result = v.object({ rows: v.array(doc), digest: v.number(), nonce: v.string() })
`)
  put('schema.ts', `import { defineSchema, defineTable } from 'convex/server'
import { fields } from './wire'
export default defineSchema({
${Array.from({ length: 32 }, (_, i) => `  ${tableName(i)}: defineTable(fields).index('by_seq', ['seq']),`).join('\n')}
})
`)
  put('mark.ts', `export function mark(limit: number, run: string, sample: string) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 8192) throw new Error('Invalid benchmark batch')
  console.log('ZODVEX_CAPACITY ' + JSON.stringify({ run, sample, limit }))
}
`)
  put('native.ts', `import { internalQuery } from './_generated/server'
import { args, result } from './wire'
import { decodeRow, encodeRow, processRows } from './workload'
import { mark } from './mark'
export const read = internalQuery({ args, returns: result, handler: async (ctx, a) => {
  mark(a.limit, a.run, a.sample)
  const raw = await ctx.db.query('benchmarkRows').withIndex('by_seq').take(a.limit)
  const result = processRows(raw.map(row => decodeRow(row)))
  return { rows: result.rows.map(row => encodeRow(row)), digest: result.digest, nonce: a.sample }
}})
`)
  for (const variant of variants.filter(v => v.name !== 'native')) {
    const mini = variant.implementation === 'mini'
    const helpers = variant.name === 'helpers'
    const lib = mini ? 'zodvex/mini' : 'zodvex'
    const server = mini ? 'zodvex/mini/server' : 'zodvex/server'
    const zodImport = mini ? "import * as s from 'zod/mini'" : "import { z as s } from 'zod'"
    put(`${variant.name}/models.ts`, `${zodImport}
${helpers ? "import { zid } from 'convex-helpers/server/zod4'" : `import { defineZodModel, zx } from '${lib}'`}
import { SecretText } from '../workload'
// Identical forward schema expressions; Mini is a separate dependency graph.
const date = s.codec(s.number(), s.date(), { decode: n => new Date(n), encode: d => d.getTime() })
${helpers ? `const secret = s.codec(s.string(), s.instanceof(SecretText), { decode: text => new SecretText(text), encode: value => value.toWire() })
const reverseDate = s.codec(s.date(), s.number(), { decode: d => d.getTime(), encode: n => new Date(n) })
const reverseSecret = s.codec(s.instanceof(SecretText), s.string(), { decode: value => value.toWire(), encode: text => new SecretText(text) })
const shape = <D extends typeof date | typeof reverseDate, S extends typeof secret | typeof reverseSecret>(at: D, text: S) => ({
  seq: s.number(), createdAt: at, secret: text, payload: s.string(), tags: s.array(s.string()),
  checkpoints: s.array(s.object({ at, value: s.number() })), reviewedAt: s.optional(s.nullable(at)),
})
export const forwardFields = shape(date, secret)
export const forwardDoc = s.object({ ...forwardFields, _id: ${helpers ? 'zid' : 'zx.id'}('benchmarkRows'), _creationTime: s.number() })
export const reverseDoc = s.object({ ...shape(reverseDate, reverseSecret), _id: ${helpers ? 'zid' : 'zx.id'}('benchmarkRows'), _creationTime: s.number() })` : ''}
${Array.from({ length: helpers ? 0 : variant.models }, (_, i) => `export const model${i} = defineZodModel('${tableName(i)}', {
  seq: s.number(), createdAt: s.codec(s.number(), s.date(), { decode: n => new Date(n), encode: d => d.getTime() }),
  secret: s.codec(s.string(), s.instanceof(SecretText), { decode: t => new SecretText(t), encode: t => t.toWire() }),
  payload: s.string(), tags: s.array(s.string()), checkpoints: s.array(s.object({ at: date, value: s.number() })),
  reviewedAt: s.optional(s.nullable(date)),
}).index('by_seq', ['seq'])`).join('\n')}
`)
    if (variant.entries) {
      put(`${variant.name}/registry.ts`, `${zodImport}
import { ${Array.from({ length: variant.models }, (_, i) => `model${i}`).join(', ')} } from './models'
// A controlled eager registry fixture, not a count of deployed functions.
export const registry = {
${Array.from({ length: variant.entries }, (_, i) => `  'unused/fn${i}': { args: s.object({ id: s.string(), label: s.optional(s.string()) }), returns: s.nullable(model${i % variant.models}.schema.doc) },`).join('\n')}
}
`)
    }
    put(`${variant.name}/query.ts`, helpers ? `import { zCustomQuery } from 'convex-helpers/server/zod4'
import { NoOp } from 'convex-helpers/server/customFunctions'
import { internalQuery } from '../_generated/server'
import { z as s } from 'zod'
import { forwardDoc, reverseDoc } from './models'
import { processRows } from '../workload'
import { mark } from '../mark'
const query = zCustomQuery(internalQuery, NoOp)
export const read = query({
  args: { limit: s.number(), run: s.string(), sample: s.string() },
  // Helpers parse returns forward; reversed codecs deliberately produce wire values.
  returns: s.object({ rows: s.array(reverseDoc), digest: s.number(), nonce: s.string() }),
  handler: async (ctx, a) => {
    mark(a.limit, a.run, a.sample)
    const raw = await ctx.db.query('benchmarkRows').withIndex('by_seq').take(a.limit)
    const result = processRows(raw.map(row => s.parse(forwardDoc, row)))
    return { ...result, nonce: a.sample }
  },
})
` : `import { initZodvex, defineZodSchema } from '${server}'
import * as convex from '../_generated/server'
${zodImport}
import { ${Array.from({ length: variant.models }, (_, i) => `model${i}`).join(', ')} } from './models'
${variant.entries ? "import { registry } from './registry'" : ''}
import { processRows } from '../workload'
import { mark } from '../mark'
const schema = defineZodSchema({ ${Array.from({ length: variant.models }, (_, i) => `${tableName(i)}: model${i}`).join(', ')} })
const { ziq } = initZodvex(schema, convex${variant.entries ? ', { registry: () => registry }' : ''})
export const read = ziq({
  args: { limit: s.number(), run: s.string(), sample: s.string() },
  returns: s.object({ rows: s.array(model0.schema.doc), digest: s.number(), nonce: s.string() }),
  handler: async (ctx, a) => {
    mark(a.limit, a.run, a.sample)
    const rows = await ctx.db.query('benchmarkRows').withIndex('by_seq').take(a.limit)
    return { ...processRows(rows), nonce: a.sample }
  },
})
`)
  }
  put('driver.ts', `import { action, internalAction, internalMutation, internalQuery } from './_generated/server'
import { makeFunctionReference } from 'convex/server'
import { v } from 'convex/values'
import { makeWireRow, assertWireResult } from './workload'
const paths: Record<string, string> = ${JSON.stringify(Object.fromEntries(variants.map(v => [v.name, v.name === 'native' ? 'native:read' : `${v.name}/query:read`])))}
async function identityHash(rows: { seq: number; _id: string; _creationTime: number }[]) {
  const bytes = new TextEncoder().encode(JSON.stringify(rows.map(row => [row.seq, row._id, row._creationTime])))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')
}
export const metadata = internalQuery({
  args: { count: v.number(), cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    rows: v.array(v.object({ seq: v.number(), _id: v.id('benchmarkRows'), _creationTime: v.number() })),
    continueCursor: v.string(), isDone: v.boolean(),
  }),
  handler: async (ctx, { count, cursor }) => {
    if (!Number.isInteger(count) || count < 1 || count > 256) throw new Error('Invalid reference page size')
    const page = await ctx.db.query('benchmarkRows').withIndex('by_seq').paginate({ numItems: count, cursor, maximumRowsRead: count })
    return {
      rows: page.page.map(({ seq, _id, _creationTime }) => ({ seq, _id, _creationTime })),
      continueCursor: page.continueCursor, isDone: page.isDone,
    }
  },
})
export const reference = action({
  args: { limit: v.number() }, returns: v.string(),
  handler: async (ctx, { limit }) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 8192) throw new Error('Invalid reference size')
    // Reference setup must not inherit the measured query's full-batch read limit.
    const rows: { seq: number; _id: string; _creationTime: number }[] = []
    let cursor: string | null = null
    while (rows.length < limit) {
      const page: { rows: typeof rows; continueCursor: string; isDone: boolean } = await ctx.runQuery(makeFunctionReference<'query'>('driver:metadata'), {
        count: Math.min(256, limit - rows.length), cursor,
      })
      rows.push(...page.rows)
      if (rows.length < limit && (page.isDone || page.continueCursor === cursor)) {
        throw new Error('HARNESS: reference dataset has too few rows or cannot advance')
      }
      cursor = page.continueCursor
    }
    return identityHash(rows)
  },
})
export const seedBatch = internalMutation({
  args: { start: v.number(), count: v.number(), payloadBytes: v.number() }, returns: v.null(),
  handler: async (ctx, { start, count, payloadBytes }) => {
    if (start < 0 || count < 1 || count > 256 || start + count > 8192 || payloadBytes < 0 || payloadBytes > 2048) throw new Error('Invalid seed batch')
    const existing = await ctx.db.query('benchmarkRows').withIndex('by_seq', q => q.gte('seq', start).lt('seq', start + count)).take(count)
    const ids = new Map(existing.map(row => [row.seq, row._id]))
    for (let seq = start; seq < start + count; seq++) {
      const row = makeWireRow(seq, payloadBytes)
      const id = ids.get(seq)
      if (id) await ctx.db.replace('benchmarkRows', id, row)
      else await ctx.db.insert('benchmarkRows', row)
    }
    return null
  },
})
export const prepare = internalAction({
  args: { count: v.number(), payloadBytes: v.number() }, returns: v.null(),
  handler: async (ctx, a) => {
    if (!Number.isInteger(a.count) || a.count < 1 || a.count > 8192) throw new Error('Invalid dataset size')
    for (let start = 0; start < a.count; start += 256) await ctx.runMutation(makeFunctionReference<'mutation'>('driver:seedBatch'), { start, count: Math.min(256, a.count-start), payloadBytes: a.payloadBytes })
    return null
  },
})
export const sample = action({
  args: { variant: v.string(), limit: v.number(), run: v.string(), sample: v.string(), payloadBytes: v.number() },
  returns: v.object({ count: v.number(), digest: v.number(), jsonBytes: v.number(), identityHash: v.string() }),
  handler: async (ctx, a) => {
    const path = paths[a.variant]
    if (!path) throw new Error('Unknown benchmark variant')
    const result = await ctx.runQuery(makeFunctionReference<'query'>(path), { limit: a.limit, run: a.run, sample: a.sample })
    if (result.rows.length !== a.limit || result.nonce !== a.sample) throw new Error('HARNESS: wrong row count/nonce')
    const expected = result.rows.map((row: { _id: string; _creationTime: number }, seq: number) => ({ ...makeWireRow(seq, a.payloadBytes), _id: row._id, _creationTime: row._creationTime }))
    assertWireResult(expected, { rows: result.rows, digest: result.digest })
    // Only the driver crosses the client boundary; measured query returns full rows.
    return { count: result.rows.length, digest: result.digest, jsonBytes: new TextEncoder().encode(JSON.stringify(result)).byteLength, identityHash: await identityHash(result.rows) }
  },
})
`)
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(destination, path)), { recursive: true })
    writeFileSync(join(destination, path), source)
  }
  return {
    variants, declaredTables: 32,
    fixtureHash: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
    files: Object.keys(files),
  }
}
