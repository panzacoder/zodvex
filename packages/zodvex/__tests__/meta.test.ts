import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { attachMeta, readMeta, type ZodvexFunctionMeta, type ZodvexModelMeta } from '../src/meta'

describe('attachMeta / readMeta', () => {
  it('attaches function metadata as non-enumerable property', () => {
    const target = () => {
      /* no-op stub */
    }
    const meta: ZodvexFunctionMeta = {
      type: 'function',
      zodArgs: z.object({ name: z.string() }),
      zodReturns: z.string()
    }
    attachMeta(target, meta)

    // Non-enumerable: should not show up in Object.keys
    expect(Object.keys(target)).not.toContain('__zodvexMeta')
    // But readMeta should find it
    const read = readMeta(target)
    expect(read).toBeDefined()
    expect(read?.type).toBe('function')
    expect((read as ZodvexFunctionMeta).zodArgs).toBeInstanceOf(z.ZodObject)
    expect((read as ZodvexFunctionMeta).zodReturns).toBeInstanceOf(z.ZodString)
  })

  it('attaches model metadata', () => {
    const target = { name: 'users' }
    const meta: ZodvexModelMeta = {
      type: 'model',
      tableName: 'users',
      schemas: {
        doc: z.object({ _id: z.string(), name: z.string() }),
        insert: z.object({ name: z.string() }),
        update: z.object({ name: z.string().optional() }),
        docArray: z.array(z.object({ _id: z.string(), name: z.string() }))
      }
    }
    attachMeta(target, meta)

    const read = readMeta(target)
    expect(read).toBeDefined()
    expect(read?.type).toBe('model')
    expect((read as ZodvexModelMeta).tableName).toBe('users')
    expect((read as ZodvexModelMeta).schemas.doc).toBeInstanceOf(z.ZodObject)
    expect((read as ZodvexModelMeta).schemas.insert).toBeInstanceOf(z.ZodObject)
    expect((read as ZodvexModelMeta).schemas.update).toBeInstanceOf(z.ZodObject)
    expect((read as ZodvexModelMeta).schemas.docArray).toBeInstanceOf(z.ZodArray)
  })

  it('readMeta returns undefined for objects without metadata', () => {
    expect(readMeta({})).toBeUndefined()
    expect(
      readMeta(() => {
        /* no-op */
      })
    ).toBeUndefined()
  })

  it('readMeta returns undefined for non-objects', () => {
    expect(readMeta(null)).toBeUndefined()
    expect(readMeta(undefined)).toBeUndefined()
    expect(readMeta(42)).toBeUndefined()
    expect(readMeta('hello')).toBeUndefined()
  })
})
