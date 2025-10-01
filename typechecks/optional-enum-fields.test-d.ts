import { z } from 'zod'
import type { VOptional, VUnion } from 'convex/values'
import { zodToConvexFields } from '../src/mapping'

// Minimal type testing helpers
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false
type Expect<T extends true> = T

// Shape with optional enums
const shape = {
  activeProfileType: z.enum(['dancer', 'choreographer']).optional(),
  profileType: z.enum(['dancer', 'choreographer', 'guest']).optional()
}

const fields = zodToConvexFields(shape)

type Active = typeof fields['activeProfileType']
type Profile = typeof fields['profileType']

// Expect optional union-of-literals validators
type _A = Expect<
  Equal<Active, VOptional<VUnion<'dancer' | 'choreographer', any[], 'required'>>>
>
type _P = Expect<
  Equal<
    Profile,
    VOptional<VUnion<'dancer' | 'choreographer' | 'guest', any[], 'required'>>
  >
>

