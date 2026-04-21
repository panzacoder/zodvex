import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { readMeta, type ZodvexModelMeta } from '../src/internal/meta'
import { defineZodModel } from '../src/internal/model'
import { zx } from '../src/internal/zx'
import { walkModelCodecs } from '../src/public/codegen/discover'

describe('codegen with slim models', () => {
  it('walkModelCodecs handles slim model (no meta.schemas)', () => {
    const model = defineZodModel(
      'users',
      {
        name: z.string(),
        createdAt: zx.date()
      },
      { schemaHelpers: false }
    )

    const meta = readMeta(model) as ZodvexModelMeta
    expect(meta.schemas).toBeUndefined()

    const codecs = walkModelCodecs('UserModel', 'models/user.ts', meta.schemas, model as any)
    // zx.date() is skipped (handled natively), but reconstruction should still succeed
    expect(codecs.length).toBe(0)
  })

  it('walkModelCodecs finds custom codecs in slim model', () => {
    const testCodec = zx.codec(
      z.object({ value: z.string(), tag: z.string() }),
      z.object({ value: z.string(), tag: z.string(), display: z.string() }),
      {
        decode: (w: any) => ({ ...w, display: `[${w.tag}] ${w.value}` }),
        encode: (r: any) => ({ value: r.value, tag: r.tag })
      }
    )

    const model = defineZodModel(
      'items',
      {
        label: testCodec,
        createdAt: zx.date()
      },
      { schemaHelpers: false }
    )

    const meta = readMeta(model) as ZodvexModelMeta
    expect(meta.schemas).toBeUndefined()

    const codecs = walkModelCodecs('ItemModel', 'models/item.ts', meta.schemas, model as any)
    expect(codecs.length).toBeGreaterThan(0)
    expect(codecs[0].codec).toBe(testCodec)
  })

  it('walkModelCodecs finds codecs in full model normally', () => {
    const model = defineZodModel('tasks', {
      title: z.string(),
      createdAt: zx.date()
    })

    const meta = readMeta(model) as ZodvexModelMeta
    expect(meta.schemas).toBeDefined()

    const codecs = walkModelCodecs('TaskModel', 'models/task.ts', meta.schemas!, model as any)
    // zx.date() is skipped — no custom codecs
    expect(codecs.length).toBe(0)
  })

  it('walkModelCodecs finds custom codecs in full model normally', () => {
    const testCodec = zx.codec(
      z.object({ value: z.string() }),
      z.object({ value: z.string(), display: z.string() }),
      {
        decode: (w: any) => ({ ...w, display: w.value }),
        encode: (r: any) => ({ value: r.value })
      }
    )

    const model = defineZodModel('tasks', {
      title: z.string(),
      data: testCodec,
      createdAt: zx.date()
    })

    const meta = readMeta(model) as ZodvexModelMeta
    expect(meta.schemas).toBeDefined()

    const codecs = walkModelCodecs('TaskModel', 'models/task.ts', meta.schemas!, model as any)
    expect(codecs.length).toBeGreaterThan(0)
    expect(codecs[0].codec).toBe(testCodec)
  })

  it('walkModelCodecs returns empty when no model ref and no schemas', () => {
    const codecs = walkModelCodecs('EmptyModel', 'models/empty.ts', undefined)
    expect(codecs.length).toBe(0)
  })
})
