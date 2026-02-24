import { describe, expect, it } from 'bun:test'
import { v } from 'convex/values'
import { z } from 'zod'
import { zodToConvex } from '../src/mapping'

describe('Issue #16: nested optional fields inside .partial()', () => {
  it('should preserve nested optional fields when parent object is wrapped with .partial() in a union', () => {
    const Experience = z.object({
      min: z.number().optional(),
      max: z.number().optional()
    })

    const Live = z.object({
      status: z.literal('live'),
      experience: Experience
    })

    const Draft = Live.partial().extend({
      status: z.literal('draft')
    })

    const TestSchema = z.union([Live, Draft])

    const validator = zodToConvex(TestSchema)

    // Expected validator structure
    const expected = v.union(
      v.object({
        status: v.literal('live'),
        experience: v.object({
          min: v.optional(v.float64()),
          max: v.optional(v.float64())
        })
      }),
      v.object({
        status: v.literal('draft'),
        experience: v.optional(
          v.object({
            min: v.optional(v.float64()),
            max: v.optional(v.float64())
          })
        )
      })
    )

    expect(validator).toEqual(expected)
  })

  it('should handle object with nested optional fields after .partial()', () => {
    const Experience = z.object({
      min: z.number().optional(),
      max: z.number().optional()
    })

    const Live = z.object({
      status: z.literal('live'),
      experience: Experience
    })

    const Draft = Live.partial()

    const liveValidator = zodToConvex(Live)
    const draftValidator = zodToConvex(Draft)

    // Live should have required experience with optional inner fields
    expect(liveValidator).toEqual(
      v.object({
        status: v.literal('live'),
        experience: v.object({
          min: v.optional(v.float64()),
          max: v.optional(v.float64())
        })
      })
    )

    // Draft should have optional experience with optional inner fields preserved
    expect(draftValidator).toEqual(
      v.object({
        status: v.optional(v.literal('live')),
        experience: v.optional(
          v.object({
            min: v.optional(v.float64()),
            max: v.optional(v.float64())
          })
        )
      })
    )
  })

  it('should preserve nested optional fields in discriminated unions', () => {
    const Experience = z.object({
      min: z.number().optional(),
      max: z.number().optional()
    })

    const Live = z.object({
      status: z.literal('live'),
      experience: Experience
    })

    const Draft = Live.partial().extend({
      status: z.literal('draft')
    })

    const TestSchema = z.discriminatedUnion('status', [Live, Draft])

    const validator = zodToConvex(TestSchema)

    // Check that nested optional fields are preserved in both branches
    const unionMembers = (validator as any).members
    expect(unionMembers).toHaveLength(2)

    // Live branch
    expect(unionMembers[0].fields.experience.fields.min.kind).toBe('float64')
    expect(unionMembers[0].fields.experience.fields.min.isOptional).toBe('optional')

    // Draft branch
    expect(unionMembers[1].fields.experience.fields.min.kind).toBe('float64')
    expect(unionMembers[1].fields.experience.fields.min.isOptional).toBe('optional')
  })
})
