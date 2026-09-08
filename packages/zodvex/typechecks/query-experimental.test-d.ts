import type { FunctionReference } from 'convex/server'
import { createZodvexHooks as createMiniHooks } from '../src/public/mini/react'
import { createZodvexHooks } from '../src/public/react'
import type { Equal, Expect } from './test-helpers'

declare const query: FunctionReference<'query', 'public', { at: Date }, { at: Date } | null>
declare const mutation: FunctionReference<'mutation', 'public', Record<string, never>, null>
declare const args: { at: Date } | 'skip'
declare const throwOnError: boolean
const { useQuery_experimental } = createZodvexHooks({})
const normal = useQuery_experimental({ query, args })
if (normal.status === 'success') {
  type _Data = Expect<Equal<typeof normal.data, { at: Date } | null>>
  // @ts-expect-error Successful queries have no error.
  normal.error
}
if (normal.status === 'error') {
  type _Error = Expect<Equal<typeof normal.error, Error>>
  // @ts-expect-error Failed queries have no data.
  normal.data
}
if (normal.status === 'pending') {
  // @ts-expect-error Pending queries have no data.
  normal.data
}
const throwing = useQuery_experimental({ query, args, throwOnError: true })
type _Throwing = Expect<Equal<typeof throwing.status, 'pending' | 'success'>>
const dynamic = useQuery_experimental({ query, args, throwOnError })
type _Dynamic = Expect<Equal<typeof dynamic.status, 'pending' | 'success' | 'error'>>
const mini = createMiniHooks({}).useQuery_experimental({ query, args })
type _Mini = Expect<Equal<typeof mini, typeof normal>>
// @ts-expect-error Runtime codec inputs are required.
useQuery_experimental({ query, args: { at: 1234 } })
// @ts-expect-error Object form requires args, including for skip.
useQuery_experimental({ query })
// @ts-expect-error Mutation references cannot be subscribed.
useQuery_experimental({ query: mutation, args: {} })
