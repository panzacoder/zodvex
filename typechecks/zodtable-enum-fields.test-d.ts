import { z } from 'zod'
import type { VOptional, VUnion } from 'convex/values'
import { zodTable } from '../src/tables'
import type { Equal, Expect } from './test-helpers'

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

