import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zodToConvexFields } from '../src/mapping'
import { pickShape, safePick } from '../src/utils'
import { $ZodOptional, $ZodString } from "zod/v4/core";

describe('pick helpers', () => {
  const User = z.object({
    id: z.string(),
    email: z.string().check(z.email()),
    firstName: z.optional(z.string()),
    lastName: z.optional(z.string()),
    createdAt: z.nullable(z.date())
  })

  it('pickShape returns subset shape', () => {
    const shape = pickShape(User, ['email', 'firstName', 'createdAt'])
    expect(Object.keys(shape).sort()).toEqual(['createdAt', 'email', 'firstName'])
    // preserve Zod types
    expect(shape.email).toBeInstanceOf($ZodString)
    expect(shape.firstName).toBeInstanceOf($ZodOptional)
  })

  it('safePick builds a new ZodObject without using .pick()', () => {
    const Clerk = safePick(User, {
      email: true,
      firstName: true,
      lastName: true
    })
    const parsed = Clerk.parse({
      email: 'a@b.com',
      firstName: undefined,
      lastName: 'L'
    })
    expect(parsed.lastName).toBe('L')
  })

  it('picked shape maps correctly to Convex validators', () => {
    const shape = pickShape(User, ['firstName', 'createdAt'])
    const validators = zodToConvexFields(shape)
    // Optional string → v.optional(v.string())
    expect((validators.firstName as any)?.isOptional).toBe('optional')
    // Date nullable → v.union(v.float64(), v.null())
    expect((validators.createdAt as any)?.kind).toBe('union')
  })
})
