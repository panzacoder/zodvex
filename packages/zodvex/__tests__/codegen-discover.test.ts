import { describe, expect, it } from 'bun:test'
import path from 'node:path'
import { z } from 'zod'
import { discoverModules, walkModelCodecs } from '../src/codegen/discover'
import { extractCodec } from '../src/codegen/extractCodec'
import { zx } from '../src/zx'

const fixtureDir = path.resolve(__dirname, 'fixtures/codegen-project')

const testCodec = zx.codec(
  z.object({ value: z.string(), tag: z.string() }),
  z.object({ value: z.string(), tag: z.string(), display: z.string() }),
  {
    decode: (w: any) => ({ ...w, display: `[${w.tag}] ${w.value}` }),
    encode: (r: any) => ({ value: r.value, tag: r.tag })
  }
)

describe('discoverModules', () => {
  it('discovers models with correct exportName and tableName', async () => {
    const result = await discoverModules(fixtureDir)

    expect(result.models.length).toBe(2) // UserModel + EventModel
    const userModel = result.models.find(m => m.exportName === 'UserModel')
    expect(userModel).toBeDefined()
    expect(userModel?.tableName).toBe('users')
    const eventModel = result.models.find(m => m.exportName === 'EventModel')
    expect(eventModel).toBeDefined()
    expect(eventModel?.tableName).toBe('events')
  })

  it('discovers functions with correct functionPath', async () => {
    const result = await discoverModules(fixtureDir)

    const fnPaths = result.functions.map(f => f.functionPath).sort()
    expect(fnPaths).toContain('users:get')
    expect(fnPaths).toContain('users:list')
    // helper has no metadata, should be excluded
    expect(fnPaths).not.toContain('users:helper')
  })

  it('skips _generated/ and _zodvex/ directories', async () => {
    const result = await discoverModules(fixtureDir)

    const allPaths = [
      ...result.models.map(m => m.sourceFile),
      ...result.functions.map(f => f.sourceFile)
    ]
    for (const p of allPaths) {
      expect(p).not.toContain('_generated')
      expect(p).not.toContain('_zodvex')
    }
  })

  it('records source file path for import generation', async () => {
    const result = await discoverModules(fixtureDir)

    const model = result.models.find(m => m.exportName === 'UserModel')
    expect(model).toBeDefined()
    expect(model?.sourceFile).toContain('models/user.ts')

    const fn = result.functions.find(f => f.functionPath === 'users:get')
    expect(fn).toBeDefined()
    expect(fn?.sourceFile).toContain('users.ts')
  })

  it('preserves full directory prefix for 1-level nested functions', async () => {
    const result = await discoverModules(fixtureDir)
    const fnPaths = result.functions.map(f => f.functionPath)

    // convex/api/reports.ts → "api/reports:summary", not "reports:summary"
    expect(fnPaths).toContain('api/reports:summary')
    expect(fnPaths).not.toContain('reports:summary')
  })

  it('preserves full directory prefix for deeply nested functions', async () => {
    const result = await discoverModules(fixtureDir)
    const fnPaths = result.functions.map(f => f.functionPath)

    // convex/admin/audit/logs.ts → "admin/audit/logs:list", not "logs:list"
    expect(fnPaths).toContain('admin/audit/logs:list')
    expect(fnPaths).not.toContain('logs:list')
  })
})

describe('codec discovery', () => {
  it('discovers exported ZodCodec instances', async () => {
    const result = await discoverModules(fixtureDir)
    expect(result.codecs.length).toBeGreaterThanOrEqual(1)
    const duration = result.codecs.find(c => c.exportName === 'zDuration')
    expect(duration).toBeDefined()
    expect(duration?.sourceFile).toBe('codecs.ts')
  })

  it('skips zx.date() codecs', async () => {
    const result = await discoverModules(fixtureDir)
    const dateCodecs = result.codecs.filter(c => c.exportName === 'zCreatedAt')
    expect(dateCodecs.length).toBe(0)
  })

  it('records schema reference for identity matching', async () => {
    const result = await discoverModules(fixtureDir)
    const duration = result.codecs.find(c => c.exportName === 'zDuration')
    expect(duration).toBeDefined()
    // The schema should be the actual ZodCodec instance
    expect(duration?.schema).toBeInstanceOf(z.ZodCodec)
  })
})

describe('walkModelCodecs', () => {
  const emptyPaginated = z.object({
    page: z.array(z.object({})),
    isDone: z.boolean(),
    continueCursor: z.string().nullable().optional()
  })

  function makeSchemas(fields: {
    doc: z.ZodObject<any>
    insert: z.ZodObject<any>
    update: z.ZodObject<any>
  }) {
    return {
      ...fields,
      docArray: z.array(fields.doc),
      paginatedDoc: emptyPaginated
    }
  }

  it('finds codec in optional field', () => {
    const schemas = makeSchemas({
      doc: z.object({ _id: z.string(), email: testCodec.optional() }),
      insert: z.object({ email: testCodec.optional() }),
      update: z.object({ email: testCodec.optional() })
    })
    const result = walkModelCodecs('TestModel', 'models/test.ts', schemas)
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[0].codec).toBe(testCodec)
    expect(result[0].modelExportName).toBe('TestModel')
    expect(result[0].fieldName).toBe('email')
    expect(result[0].schemaKey).toBe('doc')
  })

  it('deduplicates same codec across schema keys', () => {
    const schemas = makeSchemas({
      doc: z.object({ _id: z.string(), email: testCodec.optional() }),
      insert: z.object({ email: testCodec.optional() }),
      update: z.object({ email: testCodec.optional() })
    })
    const result = walkModelCodecs('TestModel', 'models/test.ts', schemas)
    const emailCodecs = result.filter(c => c.codec === testCodec)
    expect(emailCodecs.length).toBe(1)
  })

  it('finds multiple different codecs', () => {
    const otherCodec = zx.codec(z.number(), z.string(), {
      decode: (n: number) => String(n),
      encode: (s: string) => Number(s)
    })
    const schemas = makeSchemas({
      doc: z.object({ _id: z.string(), email: testCodec.optional(), phone: otherCodec.nullable() }),
      insert: z.object({ email: testCodec.optional(), phone: otherCodec.nullable() }),
      update: z.object({ email: testCodec.optional(), phone: otherCodec.optional() })
    })
    const result = walkModelCodecs('TestModel', 'models/test.ts', schemas)
    expect(result.length).toBe(2)
  })

  it('skips zx.date() codecs', () => {
    const schemas = makeSchemas({
      doc: z.object({ _id: z.string(), createdAt: zx.date() }),
      insert: z.object({ createdAt: zx.date() }),
      update: z.object({})
    })
    const result = walkModelCodecs('TestModel', 'models/test.ts', schemas)
    expect(result.length).toBe(0)
  })

  it('skips non-codec fields', () => {
    const schemas = makeSchemas({
      doc: z.object({ _id: z.string(), name: z.string(), active: z.boolean().optional() }),
      insert: z.object({ name: z.string() }),
      update: z.object({ name: z.string().optional() })
    })
    const result = walkModelCodecs('TestModel', 'models/test.ts', schemas)
    expect(result.length).toBe(0)
  })
})

describe('discoverModules modelCodecs', () => {
  it('returns modelCodecs array in discovery result', async () => {
    const result = await discoverModules(fixtureDir)
    expect(result.modelCodecs).toBeDefined()
    expect(Array.isArray(result.modelCodecs)).toBe(true)
  })
})

describe('extractCodec', () => {
  it('returns codec directly if no wrappers', () => {
    expect(extractCodec(testCodec)).toBe(testCodec)
  })

  it('unwraps .optional() to find codec', () => {
    expect(extractCodec(testCodec.optional())).toBe(testCodec)
  })

  it('unwraps .nullable() to find codec', () => {
    expect(extractCodec(testCodec.nullable())).toBe(testCodec)
  })

  it('unwraps .optional().nullable() to find codec', () => {
    expect(extractCodec(testCodec.optional().nullable())).toBe(testCodec)
  })

  it('unwraps double .optional() (from .partial()) to find codec', () => {
    expect(extractCodec(testCodec.optional().optional())).toBe(testCodec)
  })

  it('returns undefined for non-codec schemas', () => {
    expect(extractCodec(z.string())).toBeUndefined()
    expect(extractCodec(z.string().optional())).toBeUndefined()
  })

  it('skips zx.date() codecs', () => {
    expect(extractCodec(zx.date())).toBeUndefined()
    expect(extractCodec(zx.date().optional())).toBeUndefined()
  })
})
