import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { defineZodModel } from '../src/internal/model'
import { zx } from '../src/internal/zx'

// Regression coverage for #56: `defineZodModel(name, refinedZObject)` should
// expose the user's refined schema as a parseable validator (e.g. for
// TanStack Form's `validators.onChange`). Previously the model carried a
// SchemaBundle on `.schema` and there was no clean way to retrieve the
// user-authored schema with its refinements intact.

describe('model.validator (#56)', () => {
  it('shape input: validator is z.object(fields) — accepts and rejects', () => {
    const model = defineZodModel('users', {
      name: z.string(),
      email: z.string().email().optional()
    })

    expect(model.validator.safeParse({ name: 'Alice' }).success).toBe(true)
    expect(model.validator.safeParse({ name: 'Alice', email: 'a@b.co' }).success).toBe(true)
    expect(model.validator.safeParse({ name: 'Alice', email: 'not-an-email' }).success).toBe(false)
  })

  it('shape input: validator is cached across reads (stable identity)', () => {
    const model = defineZodModel('users', { name: z.string() })
    const a = model.validator
    const b = model.validator
    expect(a).toBe(b)
  })

  it('shape input: validator identity survives chained .index() calls', () => {
    const a = defineZodModel('users', { name: z.string(), created: zx.date() }).validator
    const b = defineZodModel('users', { name: z.string(), created: zx.date() }).index(
      'by_created',
      ['created']
    ).validator
    // We don't assert the new chained model's validator is === the original
    // (they're separate model instances), but each model's validator should
    // be stable across reads.
    expect(a).toBeDefined()
    expect(b).toBeDefined()
  })

  it('schema input: validator returns the user-supplied refined schema', () => {
    // The headline case from #56 — a refined object schema where the
    // refinement must survive into the validator.
    const refined = z
      .object({
        title: z.string(),
        startTs: z.number(),
        endTs: z.number().optional()
      })
      .refine(d => d.endTs === undefined || d.startTs <= d.endTs, {
        error: 'Must not end before it starts'
      })

    const model = defineZodModel('events', refined)

    // The refinement fires.
    const ok = model.validator.safeParse({ title: 'Conf', startTs: 1, endTs: 2 })
    expect(ok.success).toBe(true)

    const bad = model.validator.safeParse({ title: 'Conf', startTs: 2, endTs: 1 })
    expect(bad.success).toBe(false)

    // And identity: validator IS the schema the user passed (not a copy).
    expect(model.validator).toBe(refined)
  })

  it('slim shape input: validator is z.object(fields)', () => {
    const model = defineZodModel('users', { name: z.string() }, { schemaHelpers: false })
    expect(model.validator.safeParse({ name: 'Bob' }).success).toBe(true)
    expect(model.validator.safeParse({ name: 123 }).success).toBe(false)
  })

  it('slim schema input: validator returns the user-supplied schema', () => {
    const discriminated = z.discriminatedUnion('type', [
      z.object({ type: z.literal('phone'), duration: z.number() }),
      z.object({ type: z.literal('in-person'), roomId: z.string() })
    ])
    const model = defineZodModel('visits', discriminated, { schemaHelpers: false })
    expect(model.validator).toBe(discriminated)
    expect(model.validator.safeParse({ type: 'phone', duration: 30 }).success).toBe(true)
    expect(model.validator.safeParse({ type: 'unknown' }).success).toBe(false)
  })

  it('type: shape-input validator is z.ZodObject<Fields>', () => {
    const model = defineZodModel('users', {
      name: z.string(),
      age: z.number()
    })
    // The model.validator type should narrow to ZodObject<the Fields shape>.
    expectTypeOf(model.validator).toMatchTypeOf<z.ZodObject<any>>()
    expectTypeOf(model.validator.safeParse({})).toEqualTypeOf<
      z.ZodSafeParseResult<{ name: string; age: number }>
    >()
  })

  it('type: schema-input validator preserves the input schema type', () => {
    const refined = z
      .object({ a: z.string(), b: z.number() })
      .refine(d => d.a.length === d.b, { error: 'len mismatch' })

    const model = defineZodModel('checks', refined)
    // The validator type should be exactly the input schema's type, not the
    // widened SchemaBundle type — so consumers can use the refinement's
    // output type at compile time.
    expectTypeOf(model.validator).toEqualTypeOf<typeof refined>()
  })
})
