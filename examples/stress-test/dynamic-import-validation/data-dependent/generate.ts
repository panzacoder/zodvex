// Generator for the DATA-DEPENDENT dynamic-import variant.
//
// Where the sibling experiment imports models by index, this one validates the
// part that actually matters for zodvex's codec path: selecting a table module
// by a RUNTIME table name (the data-dependent FK-follow pattern) and decoding a
// real wire doc through the lazily-imported schema — proving a dynamically
// loaded model decodes identically to a statically imported one, across varied
// codecs.
//
// The model corpus is stamped from the task-manager example's real models, so
// the decode assertions exercise genuine codec variety:
//   - zx.date()           (timestamp -> Date)
//   - zx.id(table)        (branded string)
//   - zDuration           (number -> { hours, minutes })  custom zx.codec
//   - taggedEmail/Tag     ({value,tag} -> {value,tag,displayValue})
//   - codec nested in a discriminated-union field (activity.payload)
//   - top-level discriminated-union table (notification)
//   - slim model, schemaHelpers:false (comment)
//
// Emits a self-contained convex/ tree:
//   <outDir>/
//     codecs.ts, tagged.ts          (copied from task-manager — the codec defs)
//     models/<archetype>_NNNN.ts    (stamped copies, unique table names)
//     manifest.ts                   (tableName -> { load: () => import(...), archetype })
//     fixtures.ts                   (per-archetype wire doc + decode assertions)
//     dataDependent.ts              (the V8 action under test)

import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, copyFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TM_CONVEX = join(__dirname, '..', '..', '..', 'task-manager', 'convex')

const ARCHETYPES = ['task', 'user', 'activity', 'comment', 'notification'] as const
type Archetype = (typeof ARCHETYPES)[number]

interface Seed {
  archetype: Archetype
  source: string
  tableName: string
  exportName: string
}

function loadSeeds(): Seed[] {
  return ARCHETYPES.map((archetype) => {
    const source = readFileSync(join(TM_CONVEX, 'models', `${archetype}.ts`), 'utf-8')
    const tableName = source.match(/defineZodModel\(\s*'([^']+)'/)?.[1]
    const exportName = source.match(/export const (\w+Model)\b/)?.[1]
    if (!tableName || !exportName)
      throw new Error(`could not parse table/export from ${archetype}.ts`)
    return { archetype, source, tableName, exportName }
  })
}

const padName = (archetype: Archetype, i: number) => `${archetype}_${String(i).padStart(4, '0')}`

const FIXTURES_SOURCE = `// Per-archetype wire fixtures + decode assertions. A "wire doc" is exactly what
// Convex's DB returns; decodeDoc runs the same Zod codec decode ctx.db runs.
const TS = 1700000000000

function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error('decode assertion failed: ' + msg)
}

export const FIXTURES: Record<
  string,
  { wire: Record<string, unknown>; assert: (d: any) => string[] }
> = {
  task: {
    wire: {
      _id: 'id_task', _creationTime: TS,
      title: 'T', status: 'todo', priority: null, ownerId: 'u1',
      createdAt: TS, estimate: 90,
    },
    assert: (d) => {
      check(d.createdAt instanceof Date, 'task.createdAt -> Date (zx.date)')
      check(!!d.estimate && d.estimate.hours === 1 && d.estimate.minutes === 30, 'task.estimate -> {1h,30m} (zDuration)')
      return ['createdAt:Date', 'estimate:{hours,minutes}']
    },
  },
  user: {
    wire: {
      _id: 'id_user', _creationTime: TS,
      name: 'A', email: { value: 'a@b.com', tag: 'work' }, createdAt: TS,
    },
    assert: (d) => {
      check(d.createdAt instanceof Date, 'user.createdAt -> Date')
      check(!!d.email && d.email.displayValue === '[work] a@b.com', 'user.email -> tagged displayValue (custom codec)')
      return ['createdAt:Date', 'email.displayValue']
    },
  },
  activity: {
    wire: {
      _id: 'id_act', _creationTime: TS,
      actorId: 'u1',
      payload: { type: 'task_completed', taskId: 't1', duration: 90 },
      createdAt: TS,
    },
    assert: (d) => {
      check(d.createdAt instanceof Date, 'activity.createdAt -> Date')
      check(
        !!d.payload?.duration && d.payload.duration.hours === 1 && d.payload.duration.minutes === 30,
        'activity.payload.duration -> {1h,30m} (zDuration nested in union)',
      )
      return ['createdAt:Date', 'payload.duration:{hours,minutes}']
    },
  },
  comment: {
    wire: {
      _id: 'id_c', _creationTime: TS,
      taskId: 't1', authorId: 'u1', body: 'hi', createdAt: TS,
    },
    assert: (d) => {
      check(d.createdAt instanceof Date, 'comment.createdAt -> Date (slim model, schemaHelpers:false)')
      return ['createdAt:Date']
    },
  },
  notification: {
    wire: {
      _id: 'id_n', _creationTime: TS,
      kind: 'email', recipientId: 'u1', subject: 's', body: 'b', sentAt: TS, createdAt: TS,
    },
    assert: (d) => {
      check(d.createdAt instanceof Date, 'notification.createdAt -> Date (top-level union)')
      check(d.sentAt instanceof Date, 'notification.sentAt -> Date')
      return ['createdAt:Date', 'sentAt:Date']
    },
  },
}
`

const ACTION_SOURCE = `import { actionGeneric as action } from 'convex/server'
import { v } from 'convex/values'
import { zx, decodeDoc } from 'zodvex'
import { MANIFEST } from './manifest'
import { FIXTURES } from './fixtures'

// V8 action (NO "use node") — the q/m-faithful environment with import() enabled.
//
// Selects each table module by a RUNTIME table name (data-dependent, like an FK
// follow), dynamically imports ONLY those modules, and decodes a real wire doc
// through each lazily-loaded schema — asserting the codec types round-trip. This
// is exactly what ctx.db's reader does internally, minus the db plumbing.

export const decodeTouched = action({
  args: { tables: v.optional(v.array(v.string())), count: v.optional(v.number()) },
  returns: v.object({
    evaluated: v.number(),
    passed: v.number(),
    failed: v.number(),
    results: v.array(v.any()),
  }),
  handler: async (_ctx, { tables, count }) => {
    const allKeys = Object.keys(MANIFEST)
    const touch = tables && tables.length ? tables : spread(allKeys, count ?? 5)
    const results: Array<Record<string, unknown>> = []
    const seen = new Set<string>()
    let passed = 0
    let failed = 0

    for (const table of touch) {
      const entry = MANIFEST[table]
      if (!entry) {
        results.push({ table, decoded: false, error: 'unknown table' })
        failed++
        continue
      }
      try {
        const mod = (await entry.load()) as { __divModel: unknown } // data-dependent dynamic import
        seen.add(table)
        const docSchema = zx.doc(mod.__divModel as any)
        const fixture = FIXTURES[entry.archetype]
        const decoded = decodeDoc(docSchema as any, fixture.wire) // real codec decode of the lazy schema
        const checks = fixture.assert(decoded)
        results.push({ table, archetype: entry.archetype, decoded: true, checks })
        passed++
      } catch (e) {
        results.push({ table, archetype: entry.archetype, decoded: false, error: String((e as Error).message ?? e) })
        failed++
      }
    }
    return { evaluated: seen.size, passed, failed, results }
  },
})

/** Spread n picks across the deployed tables — still runtime-selected by key. */
function spread(keys: string[], n: number): string[] {
  const step = Math.max(1, Math.floor(keys.length / Math.max(1, n)))
  const out: string[] = []
  for (let i = 0; i < keys.length && out.length < n; i += step) out.push(keys[i])
  return out
}
`

export function generate(opts: { models: number; outDir: string }): { tables: { name: string; archetype: Archetype }[] } {
  const { models, outDir } = opts
  const seeds = loadSeeds()

  if (existsSync(outDir)) rmSync(outDir, { recursive: true })
  const modelsDir = join(outDir, 'models')
  mkdirSync(modelsDir, { recursive: true })

  // The codec definitions the stamped models import via ../codecs and ../tagged.
  copyFileSync(join(TM_CONVEX, 'codecs.ts'), join(outDir, 'codecs.ts'))
  copyFileSync(join(TM_CONVEX, 'tagged.ts'), join(outDir, 'tagged.ts'))

  const tables: { name: string; archetype: Archetype }[] = []
  const manifestEntries: string[] = []

  for (let i = 0; i < models; i++) {
    const seed = seeds[i % seeds.length]
    const suffix = String(i).padStart(4, '0')
    const uniqueTable = `${seed.tableName}_${suffix}`
    const file = padName(seed.archetype, i)

    let code = seed.source.replaceAll(`'${seed.tableName}'`, `'${uniqueTable}'`)
    code += `\n// stable alias so the action can read the model without its export name\nexport const __divModel = ${seed.exportName}\n`
    writeFileSync(join(modelsDir, `${file}.ts`), code)

    tables.push({ name: uniqueTable, archetype: seed.archetype })
    manifestEntries.push(
      `  '${uniqueTable}': { load: () => import('./models/${file}'), archetype: '${seed.archetype}' },`,
    )
  }

  writeFileSync(
    join(outDir, 'manifest.ts'),
    `// Generated: table name -> lazy loader + archetype. This is the codegen-shaped\n// artifact a real zodvex would emit (a per-table static-specifier import map).\nexport const MANIFEST: Record<string, { load: () => Promise<unknown>; archetype: string }> = {\n${manifestEntries.join('\n')}\n}\n`,
  )
  writeFileSync(join(outDir, 'fixtures.ts'), FIXTURES_SOURCE)
  writeFileSync(join(outDir, 'dataDependent.ts'), ACTION_SOURCE)
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ models, tables }, null, 2))

  return { tables }
}

// CLI: bun run generate.ts --models=750 [--out=DIR]
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const get = (k: string, d?: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d
  const models = parseInt(get('models', '750')!)
  const outDir = get('out', join(__dirname, '.out'))!
  const { tables } = generate({ models, outDir })
  console.log(`Generated ${tables.length} models + data-dependent action at ${outDir}`)
}
