import { ConvexProvider, type ConvexReactClient } from 'convex/react'
import { anyApi, makeFunctionReference } from 'convex/server'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zx } from '../src/internal/zx'
import { createZodvexHooks } from '../src/public/react/hooks'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const ref = makeFunctionReference<
  'query',
  { after: Date; paginationOpts: { numItems: number; cursor: string | null } },
  { page: { at: Date }[]; isDone: boolean; continueCursor: string }
>('tasks:list')
const hooks = createZodvexHooks({
  'tasks:list': {
    args: z.object({
      after: zx.date(),
      paginationOpts: z.object({ numItems: z.number(), cursor: z.string().nullable() })
    }),
    returns: z.object({
      page: z.array(z.object({ at: zx.date() })),
      isDone: z.boolean(),
      continueCursor: z.string()
    })
  }
})
let root: ReactTestRenderer | undefined

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
})

describe('useZodPaginatedQuery with the real Convex hook', () => {
  it('encodes filters, loads successive pages, handles skip and preserves decoded identity', async () => {
    const seen: any[] = []
    const pages = new Map<string | null, unknown>([
      [null, { page: [{ at: 123 }], isDone: false, continueCursor: 'next' }],
      ['next', { page: [{ at: 456 }], isDone: true, continueCursor: 'end' }]
    ])
    const listeners = new Set<() => void>()
    const client = {
      watchQuery(_ref: unknown, args: any) {
        seen.push(args)
        return {
          localQueryResult: () => pages.get(args.paginationOpts.cursor),
          journal: () => undefined,
          onUpdate(fn: () => void) {
            listeners.add(fn)
            return () => {
              listeners.delete(fn)
            }
          }
        }
      }
    } as unknown as ConvexReactClient
    let state: any
    function View({ skip = false }) {
      state = hooks.useZodPaginatedQuery(
        anyApi.tasks.list as typeof ref,
        skip ? 'skip' : { after: new Date(10) },
        { initialNumItems: 1 }
      )
      return null
    }
    const view = (skip = false) =>
      createElement(ConvexProvider, { client }, createElement(View, { skip }))
    await act(async () => {
      root = create(view())
    })
    expect(state.results).toEqual([{ at: new Date(123) }])
    expect(state.status).toBe('CanLoadMore')
    expect(seen[0]).toMatchObject({ after: 10, paginationOpts: { cursor: null, numItems: 1 } })
    const first = state.results
    await act(async () => root!.update(view()))
    expect(state.results).toBe(first)
    await act(async () => state.loadMore(1))
    expect(state.results).toEqual([{ at: new Date(123) }, { at: new Date(456) }])
    expect(state.status).toBe('Exhausted')
    expect(seen.some(args => args.paginationOpts.cursor === 'next')).toBe(true)
    await act(async () => root!.update(view(true)))
    expect(state.results).toEqual([])
    expect(listeners.size).toBe(0)
    await act(async () => root!.update(view()))
    expect(state.results).toEqual([{ at: new Date(123) }])
  })
  it('reports loading and live updates from actual watches', async () => {
    let wire: unknown
    const listeners = new Set<() => void>()
    const client = {
      watchQuery() {
        return {
          localQueryResult: () => wire,
          journal: () => undefined,
          onUpdate(fn: () => void) {
            listeners.add(fn)
            return () => {
              listeners.delete(fn)
            }
          }
        }
      }
    } as unknown as ConvexReactClient
    let state: any
    function View() {
      state = hooks.useZodPaginatedQuery(ref, { after: new Date(10) }, { initialNumItems: 1 })
      return null
    }
    await act(async () => {
      root = create(createElement(ConvexProvider, { client }, createElement(View)))
    })
    expect(state.status).toBe('LoadingFirstPage')
    expect(state.results).toEqual([])
    wire = { page: [{ at: 123 }], isDone: true, continueCursor: 'end' }
    await act(async () => {
      for (const notify of listeners) notify()
    })
    expect(state.results).toEqual([{ at: new Date(123) }])
    wire = { page: [{ at: 456 }], isDone: true, continueCursor: 'end' }
    await act(async () => {
      for (const notify of listeners) notify()
    })
    expect(state.results).toEqual([{ at: new Date(456) }])
  })

  it.each(['encode', 'decode', 'server'] as const)('surfaces %s failures', async kind => {
    let subscriptions = 0
    const client = {
      watchQuery() {
        subscriptions++
        return {
          localQueryResult() {
            if (kind === 'server') throw new Error('server failure')
            return { page: [{ at: 'invalid' }], isDone: true, continueCursor: 'end' }
          },
          journal: () => undefined,
          onUpdate: () => () => undefined
        }
      }
    } as unknown as ConvexReactClient
    function View() {
      hooks.useZodPaginatedQuery(
        ref,
        { after: kind === 'encode' ? ('invalid' as any) : new Date(10) },
        { initialNumItems: 1 }
      )
      return null
    }
    await expect(
      act(async () => {
        root = create(createElement(ConvexProvider, { client }, createElement(View)))
      })
    ).rejects.toThrow()
    if (kind === 'encode') expect(subscriptions).toBe(0)
  })
})
