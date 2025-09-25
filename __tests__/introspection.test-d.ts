import { describe, it, expectTypeOf } from 'vitest'
import { z } from 'zod'
import type { TableDefinition, VObject } from 'convex/server'
import { zodTable } from '../src/tables'
import { zid } from '../src/ids'
import type { VUnion, VLiteral } from 'convex/values'

describe('Table introspection preserves enum types', () => {
  it('should preserve enum type in direct validator fields', () => {
    const PROJECT_TYPES = [
      'tv-film',
      'music-video',
      'live-performance',
      'commercial'
    ] as const

    const projects = {
      type: z.enum(PROJECT_TYPES)
    }

    const Projects = zodTable('projects', projects)

    // Direct check of the validator fields
    type ValidatorFields = typeof Projects.table.validator.fields

    // This test should fail if type field is undefined
    expectTypeOf<ValidatorFields['type']>().not.toBeUndefined()

    // Check the actual type structure
    expectTypeOf<ValidatorFields['type']>().toMatchTypeOf<
      VUnion<
        'tv-film' | 'music-video' | 'live-performance' | 'commercial',
        any[],
        'required'
      >
    >()
  })

  it('should preserve optional enum type', () => {
    const projects = {
      profileType: z.enum(['dancer', 'choreographer']).optional()
    }

    const Projects = zodTable('projects', projects)

    type ValidatorFields = typeof Projects.table.validator.fields

    // This test should fail if profileType field is undefined
    expectTypeOf<ValidatorFields['profileType']>().not.toBeUndefined()
  })

  it('should show enum types in TableDefinition introspection, not undefined', () => {
    // This test should FAIL with current implementation
    // Reproducing the exact issue from packages/backend/convex/schemas/projects.ts

    const PROJECT_TYPES = [
      'tv-film',
      'music-video',
      'live-performance',
      'commercial'
    ] as const

    const LIVE_EVENT_SUBTYPES = [
      'festival',
      'tour',
      'concert',
      'corporate',
      'award-show',
      'theater',
      'other'
    ] as const

    const projects = {
      userId: zid('users'),
      profileType: z.enum(['dancer', 'choreographer']).optional(),
      profileId: z.union([zid('dancers'), zid('choreographers')]).optional(),
      private: z.boolean().optional(),
      type: z.enum(PROJECT_TYPES),
      subtype: z.enum(LIVE_EVENT_SUBTYPES).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      duration: z.string().optional(),
      link: z.string().optional(),
      media: z.union([zid('_storage'), z.string()]).optional(),
      roles: z.array(z.string()).optional(),
      title: z.string().optional(),
      studio: z.string().optional(),
      artists: z.array(z.string()).optional(),
      companyName: z.string().optional(),
      productionCompany: z.string().optional(),
      tourArtist: z.string().optional(),
      venue: z.string().optional(),
      mainTalent: z.array(z.string()).optional(),
      choreographers: z.array(z.string()).optional(),
      associateChoreographers: z.array(z.string()).optional(),
      directors: z.array(z.string()).optional(),
      searchPattern: z.string().optional()
    }

    const Projects = zodTable('projects', projects)

    // This is the type that shows in IDE introspection
    type ProjectsTable = typeof Projects.table

    // Extract the document type from the table
    type ProjectsDoc = ProjectsTable extends TableDefinition<
      infer V,
      any,
      any,
      any
    >
      ? V extends VObject<infer Fields, any, any, any>
        ? Fields
        : never
      : never

    // THE ACTUAL TEST: type field should NOT be undefined
    // This should fail with current implementation
    expectTypeOf<ProjectsDoc['type']>().not.toEqualTypeOf<undefined>()

    // It should be a union type of the enum values
    expectTypeOf<ProjectsDoc['type']>().toEqualTypeOf<
      'tv-film' | 'music-video' | 'live-performance' | 'commercial'
    >()

    // Similarly for optional enum
    expectTypeOf<ProjectsDoc['profileType']>().not.toEqualTypeOf<undefined>()
    expectTypeOf<ProjectsDoc['profileType']>().toEqualTypeOf<
      'dancer' | 'choreographer' | undefined
    >()

    // And for subtype
    expectTypeOf<ProjectsDoc['subtype']>().not.toEqualTypeOf<undefined>()
    expectTypeOf<ProjectsDoc['subtype']>().toMatchTypeOf<
      'festival' | 'tour' | 'concert' | 'corporate' | 'award-show' | 'theater' | 'other' | undefined
    >()
  })

  it('should preserve simple enum in table introspection', () => {
    // Simpler test case
    const shape = {
      status: z.enum(['active', 'inactive', 'pending'])
    }

    const TestTable = zodTable('test', shape)

    type TestTableType = typeof TestTable.table
    type TestDoc = TestTableType extends TableDefinition<
      infer V,
      any,
      any,
      any
    >
      ? V extends VObject<infer Fields, any, any, any>
        ? Fields
        : never
      : never

    // This should fail if enums show as undefined
    expectTypeOf<TestDoc['status']>().not.toEqualTypeOf<undefined>()
    expectTypeOf<TestDoc['status']>().toEqualTypeOf<'active' | 'inactive' | 'pending'>()
  })
})