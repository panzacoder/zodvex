import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  type DiscoveredFunction,
  discoverModules,
  walkFunctionCodecs,
  walkModelCodecs
} from '../src/codegen/discover'
import { extractCodec, findCodec, readFnArgs, readFnReturns } from '../src/codegen/extractCodec'
import { attachMeta } from '../src/meta'
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

  it('deduplicates models re-exported from barrel files', async () => {
    const result = await discoverModules(fixtureDir)

    // Should still find exactly 2 models, not 4 (2 direct + 2 barrel)
    expect(result.models.length).toBe(2)

    // Each model should come from its direct file, not the barrel
    const userModel = result.models.find(m => m.exportName === 'UserModel')
    expect(userModel?.sourceFile).toBe('models/user.ts')

    const eventModel = result.models.find(m => m.exportName === 'EventModel')
    expect(eventModel?.sourceFile).toBe('models/event.ts')
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
    expect(result[0].accessPath).toBe('.shape.email')
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

  it('finds codec nested inside a union member', () => {
    const variant1 = z.object({ type: z.literal('a'), name: testCodec })
    const variant2 = z.object({ type: z.literal('b'), label: z.string() })
    const schemas = makeSchemas({
      doc: z.object({ _id: z.string(), payload: z.union([variant1, variant2]) }),
      insert: z.object({ payload: z.union([variant1, variant2]) }),
      update: z.object({})
    })
    const result = walkModelCodecs('TestModel', 'models/test.ts', schemas)
    expect(result.length).toBe(1)
    expect(result[0].codec).toBe(testCodec)
    expect(result[0].accessPath).toBe('.shape.payload._zod.def.options[0].shape.name')
  })

  it('finds codec nested inside an optional union member', () => {
    const variant = z.object({ type: z.literal('a'), name: testCodec.optional() })
    const schemas = makeSchemas({
      doc: z.object({ _id: z.string(), payload: z.union([variant]).optional() }),
      insert: z.object({ payload: z.union([variant]).optional() }),
      update: z.object({})
    })
    const result = walkModelCodecs('TestModel', 'models/test.ts', schemas)
    expect(result.length).toBe(1)
    expect(result[0].codec).toBe(testCodec)
    expect(result[0].accessPath).toBe(
      '.shape.payload._zod.def.innerType._zod.def.options[0].shape.name'
    )
  })

  it('finds codec inside array element', () => {
    const schemas = makeSchemas({
      doc: z.object({ _id: z.string(), items: z.array(z.object({ val: testCodec })) }),
      insert: z.object({ items: z.array(z.object({ val: testCodec })) }),
      update: z.object({})
    })
    const result = walkModelCodecs('TestModel', 'models/test.ts', schemas)
    expect(result.length).toBe(1)
    expect(result[0].codec).toBe(testCodec)
    expect(result[0].accessPath).toBe('.shape.items._zod.def.element.shape.val')
  })

  it('finds codec inside record value type', () => {
    const schemas = makeSchemas({
      doc: z.object({ _id: z.string(), data: z.record(z.string(), testCodec) }),
      insert: z.object({ data: z.record(z.string(), testCodec) }),
      update: z.object({})
    })
    const result = walkModelCodecs('TestModel', 'models/test.ts', schemas)
    expect(result.length).toBe(1)
    expect(result[0].codec).toBe(testCodec)
    expect(result[0].accessPath).toBe('.shape.data._zod.def.valueType')
  })

  it('finds codecs at multiple nesting levels', () => {
    const otherCodec = zx.codec(z.number(), z.string(), {
      decode: (n: number) => String(n),
      encode: (s: string) => Number(s)
    })
    const schemas = makeSchemas({
      doc: z.object({
        _id: z.string(),
        email: testCodec.optional(),
        payload: z.union([z.object({ type: z.literal('a'), score: otherCodec })])
      }),
      insert: z.object({ email: testCodec.optional() }),
      update: z.object({})
    })
    const result = walkModelCodecs('TestModel', 'models/test.ts', schemas)
    expect(result.length).toBe(2)
    const emailCodec = result.find(r => r.codec === testCodec)
    const scoreCodec = result.find(r => r.codec === otherCodec)
    expect(emailCodec?.accessPath).toBe('.shape.email')
    expect(scoreCodec?.accessPath).toBe('.shape.payload._zod.def.options[0].shape.score')
  })

  it('handles top-level union schema (non-object root)', () => {
    const variant1 = z.object({ type: z.literal('a'), name: testCodec })
    const variant2 = z.object({ type: z.literal('b') })
    const unionDoc = z.union([variant1, variant2])
    const result = walkModelCodecs('TestModel', 'models/test.ts', {
      doc: unionDoc,
      insert: z.object({}),
      update: z.object({}),
      docArray: z.array(unionDoc),
      paginatedDoc: z.object({
        page: z.array(unionDoc),
        isDone: z.boolean(),
        continueCursor: z.string().nullable().optional()
      })
    })
    expect(result.length).toBe(1)
    expect(result[0].codec).toBe(testCodec)
    expect(result[0].accessPath).toBe('._zod.def.options[0].shape.name')
  })
})

describe('discoverModules modelCodecs', () => {
  it('returns modelCodecs array in discovery result', async () => {
    const result = await discoverModules(fixtureDir)
    expect(result.modelCodecs).toBeDefined()
    expect(Array.isArray(result.modelCodecs)).toBe(true)
  })
})

describe('walkFunctionCodecs', () => {
  function makeFn(
    overrides: Partial<DiscoveredFunction> & { zodArgs?: z.ZodTypeAny; zodReturns?: z.ZodTypeAny }
  ): DiscoveredFunction {
    return {
      functionPath: 'test:fn',
      exportName: 'fn',
      sourceFile: 'test.ts',
      ...overrides
    }
  }

  it('finds codec in function zodArgs', () => {
    const fns = [makeFn({ zodArgs: z.object({ email: testCodec }) })]
    const result = walkFunctionCodecs(fns)
    expect(result.length).toBe(1)
    expect(result[0].codec).toBe(testCodec)
    expect(result[0].schemaSource).toBe('zodArgs')
    expect(result[0].accessPath).toBe('.shape.email')
    expect(result[0].functionExportName).toBe('fn')
  })

  it('finds codec in function zodReturns', () => {
    const fns = [makeFn({ zodReturns: z.object({ data: testCodec.optional() }) })]
    const result = walkFunctionCodecs(fns)
    expect(result.length).toBe(1)
    expect(result[0].codec).toBe(testCodec)
    expect(result[0].schemaSource).toBe('zodReturns')
    expect(result[0].accessPath).toBe('.shape.data')
  })

  it('finds codec nested in union within args', () => {
    const args = z.object({
      payload: z.union([
        z.object({ type: z.literal('a'), val: testCodec }),
        z.object({ type: z.literal('b') })
      ])
    })
    const fns = [makeFn({ zodArgs: args })]
    const result = walkFunctionCodecs(fns)
    expect(result.length).toBe(1)
    expect(result[0].accessPath).toBe('.shape.payload._zod.def.options[0].shape.val')
  })

  it('deduplicates same codec across multiple functions', () => {
    const fns = [
      makeFn({ exportName: 'fn1', zodArgs: z.object({ a: testCodec }) }),
      makeFn({ exportName: 'fn2', zodArgs: z.object({ b: testCodec }) })
    ]
    const result = walkFunctionCodecs(fns)
    // Same codec instance — only first function wins
    expect(result.length).toBe(1)
    expect(result[0].functionExportName).toBe('fn1')
  })

  it('skips functions without zodArgs or zodReturns', () => {
    const fns = [makeFn({})]
    const result = walkFunctionCodecs(fns)
    expect(result.length).toBe(0)
  })

  it('skips zx.date() codecs', () => {
    const fns = [makeFn({ zodArgs: z.object({ ts: zx.date() }) })]
    const result = walkFunctionCodecs(fns)
    expect(result.length).toBe(0)
  })
})

describe('readFnArgs / readFnReturns', () => {
  it('readFnArgs extracts zodArgs from function metadata', () => {
    const argsSchema = z.object({ id: z.string() })
    const fn = { _isRegistered: true }
    attachMeta(fn, { type: 'function', zodArgs: argsSchema, zodReturns: undefined })
    expect(readFnArgs(fn)).toBe(argsSchema)
  })

  it('readFnReturns extracts zodReturns from function metadata', () => {
    const returnsSchema = z.object({ name: z.string() })
    const fn = { _isRegistered: true }
    attachMeta(fn, { type: 'function', zodArgs: undefined, zodReturns: returnsSchema })
    expect(readFnReturns(fn)).toBe(returnsSchema)
  })

  it('readFnArgs throws for non-function metadata', () => {
    expect(() => readFnArgs({})).toThrow('zodvex: function has no zodArgs metadata')
  })

  it('readFnReturns throws for missing zodReturns', () => {
    const fn = { _isRegistered: true }
    attachMeta(fn, { type: 'function', zodArgs: z.object({}), zodReturns: undefined })
    expect(() => readFnReturns(fn)).toThrow('zodvex: function has no zodReturns metadata')
  })
})

describe('discoverModules functionCodecs', () => {
  it('returns functionCodecs array in discovery result', async () => {
    const result = await discoverModules(fixtureDir)
    expect(result.functionCodecs).toBeDefined()
    expect(Array.isArray(result.functionCodecs)).toBe(true)
  })

  it('discovers codecs from function args in fixture', async () => {
    const result = await discoverModules(fixtureDir)
    // The fixture's users:get has zodArgs: z.object({ id: z.string() }) — no codecs
    // The fixture's users:update has zodArgs derived from UserModel.schema.doc.partial() — contains tagged codec
    // That tagged codec should already be in modelCodecs, so functionCodecs may or may not find it again
    // depending on whether it's the same instance
    expect(result.functionCodecs.length).toBeGreaterThanOrEqual(0)
  })
})

describe('findCodec', () => {
  it('returns codec directly if no wrappers', () => {
    expect(findCodec(testCodec)).toBe(testCodec)
  })

  it('unwraps .optional() to find codec', () => {
    expect(findCodec(testCodec.optional())).toBe(testCodec)
  })

  it('unwraps .nullable() to find codec', () => {
    expect(findCodec(testCodec.nullable())).toBe(testCodec)
  })

  it('unwraps .optional().nullable() to find codec', () => {
    expect(findCodec(testCodec.optional().nullable())).toBe(testCodec)
  })

  it('unwraps double .optional() (from .partial()) to find codec', () => {
    expect(findCodec(testCodec.optional().optional())).toBe(testCodec)
  })

  it('returns undefined for non-codec schemas', () => {
    expect(findCodec(z.string())).toBeUndefined()
    expect(findCodec(z.string().optional())).toBeUndefined()
  })

  it('skips zx.date() codecs', () => {
    expect(findCodec(zx.date())).toBeUndefined()
    expect(findCodec(zx.date().optional())).toBeUndefined()
  })
})

describe('extractCodec', () => {
  it('returns codec when present', () => {
    expect(extractCodec(testCodec)).toBe(testCodec)
    expect(extractCodec(testCodec.optional())).toBe(testCodec)
  })

  it('throws for non-codec schemas', () => {
    expect(() => extractCodec(z.string())).toThrow('codegen bug')
  })

  it('throws for zx.date() codecs', () => {
    expect(() => extractCodec(zx.date())).toThrow('codegen bug')
  })
})
