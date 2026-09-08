import { makeFunctionReference } from 'convex/server'
import { createZodvexHooks } from '../src/public/react/hooks'
const { useZodPaginatedQuery } = createZodvexHooks({})
const ref = makeFunctionReference<'query', { after: Date; paginationOpts?: {cursor: string | null; numItems: number} }, {page: {at: Date}[]; isDone:boolean; continueCursor:string}>('tasks:list')
const args = Math.random() ? { after: new Date() } : 'skip'
const result = useZodPaginatedQuery(ref, args, {initialNumItems:10})
result.results[0].at.getTime()
// @ts-expect-error decoded Date cannot be treated as a number
const number: number = result.results[0].at
// @ts-expect-error Date filters require runtime values
useZodPaginatedQuery(ref, { after: 123 }, {initialNumItems:10})
// @ts-expect-error Convex manages paginationOpts
useZodPaginatedQuery(ref, { after: new Date(), paginationOpts: {cursor:null,numItems:10} }, {initialNumItems:10})
// @ts-expect-error required domain args cannot be omitted
useZodPaginatedQuery(ref, {}, {initialNumItems:10})
// @ts-expect-error only paginated queries may be used
useZodPaginatedQuery(makeFunctionReference<'query', {}, string>('tasks:get'), {}, {initialNumItems:10})

function wrap<Q extends import('convex/server').FunctionReference<'query', 'public'>>(query: Q, args: Omit<import('convex/server').FunctionArgs<Q>, 'paginationOpts'> | 'skip') {
  return useZodPaginatedQuery(query, args, {initialNumItems:10})
}
