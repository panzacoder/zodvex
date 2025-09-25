import { describe, it, expectTypeOf } from 'vitest'
import { z } from 'zod'
import { v } from 'convex/values'
import type { Id } from 'convex/_generated/dataModel'
import { zodTable } from '../src/tables'
import { zid } from '../src/ids'
import type { VUnion, VLiteral, VOptional } from 'convex/values'

describe('zodTable enum preservation', () => {
  it('preserves enum types in table definition', () => {
    const PROJECT_TYPES = [
      'tv-film',
      'music-video',
      'live-performance',
      'commercial'
    ] as const

    const testShape = {
      type: z.enum(PROJECT_TYPES),
      optional: z.enum(['active', 'inactive']).optional(),
      name: z.string()
    }

    const TestTable = zodTable('test', testShape)

    // Check that the table validator fields preserve enum types
    type Fields = typeof TestTable.table.validator.fields

    // The enum should be a union of literals
    expectTypeOf<Fields['type']>().toMatchTypeOf<
      VUnion<
        'tv-film' | 'music-video' | 'live-performance' | 'commercial',
        [
          VLiteral<'tv-film', 'required'>,
          VLiteral<'music-video', 'required'>,
          VLiteral<'live-performance', 'required'>,
          VLiteral<'commercial', 'required'>
        ],
        'required'
      >
    >()

    // Optional enum should be wrapped in VOptional
    expectTypeOf<Fields['optional']>().toMatchTypeOf<
      VOptional<
        VUnion<
          'active' | 'inactive',
          [VLiteral<'active', 'required'>, VLiteral<'inactive', 'required'>],
          'required'
        >
      >
    >()

    // Regular string field
    expectTypeOf<Fields['name']>().toMatchTypeOf<v.ValidatorTypeFor<string>>()
  })

  it('preserves complex enum scenarios', () => {
    const LIVE_EVENT_SUBTYPES = [
      'festival',
      'tour',
      'concert',
      'corporate',
      'award-show',
      'theater',
      'other'
    ] as const

    const testShape = {
      // Required enum
      profileType: z.enum(['dancer', 'choreographer']),
      // Optional enum with many values
      subtype: z.enum(LIVE_EVENT_SUBTYPES).optional(),
      // Union of IDs (not enum but similar union type)
      profileId: z.union([zid('dancers'), zid('choreographers')]).optional()
    }

    const TestTable = zodTable('test', testShape)

    type Fields = typeof TestTable.table.validator.fields

    // Required enum
    expectTypeOf<Fields['profileType']>().toMatchTypeOf<
      VUnion<
        'dancer' | 'choreographer',
        [
          VLiteral<'dancer', 'required'>,
          VLiteral<'choreographer', 'required'>
        ],
        'required'
      >
    >()

    // Optional enum with many values
    expectTypeOf<Fields['subtype']>().toMatchTypeOf<
      VOptional<
        VUnion<
          'festival' | 'tour' | 'concert' | 'corporate' | 'award-show' | 'theater' | 'other',
          any[],
          'required'
        >
      >
    >()

    // Union of IDs
    expectTypeOf<Fields['profileId']>().toMatchTypeOf<
      VOptional<
        VUnion<
          Id<'dancers'> | Id<'choreographers'>,
          any[],
          'required'
        >
      >
    >()
  })

  it('preserves single-value enums as literals', () => {
    const testShape = {
      singleEnum: z.enum(['only-value']),
      optionalSingle: z.enum(['single']).optional()
    }

    const TestTable = zodTable('test', testShape)

    type Fields = typeof TestTable.table.validator.fields

    // Single value enum should be a literal
    expectTypeOf<Fields['singleEnum']>().toMatchTypeOf<
      VLiteral<'only-value', 'required'>
    >()

    // Optional single value enum
    expectTypeOf<Fields['optionalSingle']>().toMatchTypeOf<
      VOptional<VLiteral<'single', 'required'>>
    >()
  })
})