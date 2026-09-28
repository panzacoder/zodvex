import { z } from 'zod'
import { zx } from 'zodvex'
import { ZodvexDatabaseWriter } from 'zodvex/server'
import { generateModelDescriptors } from './historical-emitter'
import { secretCodec, SecretText, validatedTextCodec } from './codecs.mjs'
import { memoryDatabase, exercise, TS } from './db-fixture.mjs'
import { probeModel } from './models.mjs'

function emit(schema: any) {
  const output = generateModelDescriptors([{
    tableName: 'probe', exportName: 'Model', sourceFile: 'model.ts',
    schemas: { doc: schema, insert: schema } as any,
  }], [{ exportName: 'secretCodec', sourceFile: 'codecs.mjs', schema: secretCodec },
    { exportName: 'validatedTextCodec', sourceFile: 'codecs.mjs', schema: validatedTextCodec }])
  if (!output.files.length) return { entry: undefined, output }
  const body = output.files[0].js.split('\n').filter(line => !line.startsWith('import ')).join('\n')
    .replace('export default', 'return')
  return { entry: new Function('z', 'zx', 'secretCodec', 'validatedTextCodec', 'Model', body)(z, zx, secretCodec, validatedTextCodec, {
    schema: { doc: schema, insert: schema },
  }), output }
}

export async function characterize() {
  const rows: any[] = []
  async function check(name: string, schema: any, operation: (db: any) => Promise<boolean>, wire?: any) {
    const generated = emit(schema)
    const observations: Record<string, any> = {}
    for (const [kind, entry] of [['full', { doc: schema, insert: schema }], ['descriptor', generated.entry]] as const) {
      const raw = memoryDatabase(wire ? [{ ...wire, _id: 'probe:1', _creationTime: 1 }] : [])
      try {
        observations[kind] = { passes: await operation(new ZodvexDatabaseWriter(raw.database as any, entry ? { probe: entry } : {})) }
      } catch (error) {
        observations[kind] = { passes: false, error: String(error) }
      }
    }
    rows.push({ name, ...observations, fallbacks: generated.output.fallbacks, insertFallbacks: generated.output.insertFallbacks })
  }
  const rejects = async (operation: () => Promise<unknown>) => {
    try { await operation(); return false } catch { return true }
  }
  const base = z.object({ name: z.string(), at: zx.date() })
  await check('valid Date read', base, async db => (await db.get('probe', 'probe:1')).at.getTime() === TS, { name: 'ok', at: TS })
  await check('invalid codec read rejected', base, db => rejects(() => db.get('probe', 'probe:1')), { name: 'ok', at: 'bad' })
  await check('ordinary invalid read rejected', base, db => rejects(() => db.get('probe', 'probe:1')), { name: 99, at: TS })
  await check('ordinary invalid insert rejected', base, db => rejects(() => db.insert('probe', { name: 99, at: new Date(TS) })))
  await check('ordinary missing insert rejected', base, db => rejects(() => db.insert('probe', { at: new Date(TS) })))
  await check('ordinary invalid replace rejected', base, db => rejects(() => db.replace('probe', 'probe:1', { name: 99, at: new Date(TS) })), { name: 'ok', at: TS })
  const refined = z.object({ name: z.string().min(3), at: zx.date() })
  await check('ordinary read refinement retained', refined, db => rejects(() => db.get('probe', 'probe:1')), { name: 'x', at: TS })
  await check('built-in insert refinement retained', refined, db => rejects(() => db.insert('probe', { name: 'x', at: new Date(TS) })))
  const custom = z.object({ name: z.string().refine(value => value === 'accepted'), at: zx.date() })
  await check('custom insert refinement fallback retained', custom, db => rejects(() => db.insert('probe', { name: 'wrong', at: new Date(TS) })))
  await check('custom read refinement retained', custom, db => rejects(() => db.get('probe', 'probe:1')), { name: 'wrong', at: TS })
  await check('ordinary read default retained', z.object({ name: z.string().default('default'), at: zx.date() }),
    async db => (await db.get('probe', 'probe:1')).name === 'default', { at: TS })
  await check('codec read default retained', z.object({ at: zx.date().default(new Date(TS)) }),
    async db => (await db.get('probe', 'probe:1')).at.getTime() === TS, {})
  await check('ordinary read transform retained', z.object({ name: z.string().transform(value => value.toUpperCase()), at: zx.date() }),
    async db => (await db.get('probe', 'probe:1')).name === 'LOWER', { name: 'lower', at: TS })
  const union = z.discriminatedUnion('kind', [z.object({ kind: z.literal('event'), at: zx.date() }), z.object({ kind: z.literal('plain'), name: z.string() })])
  await check('valid union codec read', union, async db => (await db.get('probe', 'probe:1')).at.getTime() === TS, { kind: 'event', at: TS })
  await check('invalid union codec read rejected', union, db => rejects(() => db.get('probe', 'probe:1')), { kind: 'event', at: 'bad' })
  const validatedUnion = z.discriminatedUnion('kind', [z.object({ kind: z.literal('checked'), text: validatedTextCodec }), z.object({ kind: z.literal('plain'), name: z.string() })])
  await check('wire-valid invalid union codec rejected', validatedUnion, db => rejects(() => db.get('probe', 'probe:1')), { kind: 'checked', text: 'x' })
  await check('unknown union discriminator rejected', union, db => rejects(() => db.get('probe', 'probe:1')), { kind: 'other', at: TS })
  await check('nullable optional codec retained', z.object({ at: z.optional(z.nullable(zx.date())) }),
    async db => (await db.get('probe', 'probe:1')).at === null, { at: null })
  await check('custom codec runtime class retained', z.object({ secret: secretCodec }),
    async db => (await db.get('probe', 'probe:1')).secret instanceof SecretText, { secret: 'fixture' })

  const probe = probeModel()
  const descriptor = generateModelDescriptors([{ tableName: 'probe', exportName: 'Model', sourceFile: 'model.ts', schemas: probe.schema }],
    [{ exportName: 'secretCodec', sourceFile: 'codecs.mjs', schema: secretCodec }])
  const source = descriptor.files[0].js.split('\n').filter(line => !line.startsWith('import ')).join('\n').replace('export default', 'return')
  const entry = new Function('z', 'zx', 'secretCodec', source)(z, zx, secretCodec)
  const operations = { full: await exercise({ probe: { doc: probe.schema.doc, insert: probe.schema.insert } }), descriptor: await exercise({ probe: entry }) }
  for (const key of ['wireEncoded', 'decoded', 'codecPatch', 'ordinaryPatch', 'unset', 'replaceAndQuery'] as const) {
    rows.push({ name: `wrapped operation: ${key}`, full: { passes: operations.full[key] }, descriptor: { passes: operations.descriptor[key] } })
  }
  const mismatches = rows.filter(row => row.full.passes !== row.descriptor.passes).map(row => row.name)
  return { contractStatus: mismatches.length ? 'FAILED' : 'PASSED', baselinePasses: rows.every(row => row.full.passes),
    mismatches, rows, operations }
}
