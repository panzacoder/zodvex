import { z } from 'zod'
import type { VOptional, VUnion } from 'convex/values'
import { zodTable } from '../src/tables'

// Minimal type testing helpers
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false
type Expect<T extends true> = T

// Shape with optional enum
const shape = {
  activeProfileType: z.enum(['dancer', 'choreographer']).optional()
}

const Users = zodTable('users', shape)

type Active = typeof Users.doc.fields['activeProfileType']

// Expect optional union-of-literals validator preserved through zodTable
type _A = Expect<
  Equal<Active, VOptional<VUnion<'dancer' | 'choreographer', any[], 'required'>>>
>

