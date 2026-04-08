/**
 * Tests for defineZodModel union schema overload
 *
 * Compile-time type assertions validate FieldPaths distribution over union variants.
 * Runtime tests validate the defineZodModel API with union schemas.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { readMeta, type ZodvexModelMeta } from '../src/internal/meta'
import { defineZodModel, type FieldPaths, type ModelFieldPaths } from '../src/internal/model'
import { isZodUnion } from '../src/internal/schemaHelpers'

// ============================================================================
// Type-Level Assertions
// ============================================================================

type AssertAssignable<A, B> = A extends B ? true : false

// Union field paths should distribute over variants
type VisitUnion = z.ZodDiscriminatedUnion<
  [
    z.ZodObject<{
      type: z.ZodLiteral<'phone'>
      duration: z.ZodNumber
      notes: z.ZodOptional<z.ZodString>
    }>,
    z.ZodObject<{ type: z.ZodLiteral<'in-person'>; roomId: z.ZodString; checkedIn: z.ZodBoolean }>
  ],
  'type'
>

type VisitPaths = ModelFieldPaths<VisitUnion>
type _v1 = AssertAssignable<'type', VisitPaths>
type _v2 = AssertAssignable<'duration', VisitPaths>
type _v3 = AssertAssignable<'roomId', VisitPaths>
type _v4 = AssertAssignable<'_creationTime', VisitPaths>
const _vCheck1: _v1 = true
const _vCheck2: _v2 = true
const _vCheck3: _v3 = true
const _vCheck4: _v4 = true

// ============================================================================
// Runtime Tests
// ============================================================================

describe('defineZodModel with union schema', () => {
  const visitSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('phone'), duration: z.number(), notes: z.string().optional() }),
    z.object({ type: z.literal('in-person'), roomId: z.string(), checkedIn: z.boolean() })
  ])

  it('accepts a discriminated union schema', () => {
    const Visits = defineZodModel('visits', visitSchema)

    expect(Visits.name).toBe('visits')
    expect(Visits.indexes).toEqual({})
  })

  it('schema.insert is the original union (no system fields)', () => {
    const Visits = defineZodModel('visits', visitSchema)

    expect(Visits.schema.insert).toBe(visitSchema)
    expect(Visits.schema.base).toBe(visitSchema)
  })

  it('schema.doc adds system fields to each variant', () => {
    const Visits = defineZodModel('visits', visitSchema)

    // Should be a union
    expect(isZodUnion(Visits.schema.doc)).toBe(true)

    // Each variant should have _id and _creationTime
    const phoneResult = Visits.schema.doc.safeParse({
      type: 'phone',
      duration: 30,
      _id: 'visits:123',
      _creationTime: 1
    })
    expect(phoneResult.success).toBe(true)

    const inPersonResult = Visits.schema.doc.safeParse({
      type: 'in-person',
      roomId: 'room1',
      checkedIn: true,
      _id: 'visits:456',
      _creationTime: 2
    })
    expect(inPersonResult.success).toBe(true)
  })

  it('schema.doc rejects docs without system fields', () => {
    const Visits = defineZodModel('visits', visitSchema)

    const result = Visits.schema.doc.safeParse({
      type: 'phone',
      duration: 30
    })
    expect(result.success).toBe(false)
  })

  it('schema.update has _id required, user fields partial', () => {
    const Visits = defineZodModel('visits', visitSchema)

    // _id required, everything else optional
    const result = Visits.schema.update.safeParse({
      _id: 'visits:123',
      type: 'phone'
    })
    expect(result.success).toBe(true)

    // Missing _id should fail
    const bad = Visits.schema.update.safeParse({ type: 'phone' })
    expect(bad.success).toBe(false)
  })

  it('schema.docArray validates array of union docs', () => {
    const Visits = defineZodModel('visits', visitSchema)

    const result = Visits.schema.docArray.safeParse([
      { type: 'phone', duration: 30, _id: 'v1', _creationTime: 1 },
      { type: 'in-person', roomId: 'r1', checkedIn: false, _id: 'v2', _creationTime: 2 }
    ])
    expect(result.success).toBe(true)
  })

  it('schema.paginatedDoc wraps union doc correctly', () => {
    const Visits = defineZodModel('visits', visitSchema)

    const result = Visits.schema.paginatedDoc.safeParse({
      page: [{ type: 'phone', duration: 30, _id: 'v1', _creationTime: 1 }],
      isDone: false,
      continueCursor: null
    })
    expect(result.success).toBe(true)
  })

  it('supports z.union (non-discriminated)', () => {
    const schema = z.union([
      z.object({ kind: z.literal('a'), x: z.number() }),
      z.object({ kind: z.literal('b'), y: z.string() })
    ])

    const Model = defineZodModel('items', schema)

    expect(Model.name).toBe('items')
    expect(isZodUnion(Model.schema.doc)).toBe(true)
  })

  it('chainable .index() works with union model', () => {
    const Visits = defineZodModel('visits', visitSchema)
      .index('byType', ['type'])
      .index('byCreation', ['_creationTime'])

    expect(Visits.indexes).toEqual({
      byType: ['type', '_creationTime'],
      byCreation: ['_creationTime', '_creationTime']
    })
  })

  it('metadata is attached and preserved through chaining', () => {
    const Visits = defineZodModel('visits', visitSchema).index('byType', ['type'])

    const meta = readMeta(Visits)
    expect(meta).toBeDefined()
    expect(meta?.type).toBe('model')

    const mmeta = meta as ZodvexModelMeta
    expect(mmeta.tableName).toBe('visits')
    expect(mmeta.definitionSource).toBe('schema')
    expect(mmeta.schemas.doc).toBeDefined()
    expect(mmeta.schemas.insert).toBeDefined()
  })
})
