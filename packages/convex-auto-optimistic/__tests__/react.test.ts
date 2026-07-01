import { anyApi } from 'convex/server'
import { describe, expect, it, vi } from 'vitest'
import type { LocalStoreLike } from '../src/apply-to-store'
import type { TableGraphLike } from '../src/types'

// The hook only uses useMemo; run it eagerly so no React renderer is needed.
vi.mock('react', () => ({ useMemo: (fn: () => unknown) => fn() }))

// Replace convex/react's useMutation with a fake that mimics the real
// contract: a callable ReactMutation with .withOptimisticUpdate() that runs
// the update against a local store when the mutation is invoked.
const harness: {
  store: LocalStoreLike
  rawCalls: unknown[]
  serverResult: unknown
} = {
  store: { getAllQueries: () => [], setQuery: () => {} },
  rawCalls: [],
  serverResult: 'server-result'
}

vi.mock('convex/react', () => ({
  useMutation: (_ref: unknown) => {
    const call = async (args: unknown) => {
      harness.rawCalls.push(args)
      return harness.serverResult
    }
    const mutation = Object.assign(call, {
      withOptimisticUpdate: (update: (store: LocalStoreLike, args: unknown) => void) =>
        Object.assign(
          async (args: unknown) => {
            update(harness.store, args)
            return call(args)
          },
          { withOptimisticUpdate: mutation.withOptimisticUpdate }
        )
    })
    return mutation
  }
}))

import { createAutoOptimistic } from '../src/react'

const graph: TableGraphLike = {
  functions: {
    'tasks:list': { kind: 'query', visibility: 'public', reads: ['tasks'], writes: [] },
    'tasks:create': { kind: 'mutation', visibility: 'public', reads: [], writes: ['tasks'] }
  }
}

function setupStore(initial: Array<{ args: unknown; value: unknown }>) {
  const sets: Array<{ args: unknown; value: unknown }> = []
  harness.rawCalls = []
  harness.serverResult = 'server-result'
  harness.store = {
    getAllQueries: () => initial,
    setQuery: (_ref, args, value) => sets.push({ args, value })
  }
  return sets
}

describe('useAutoMutation — path extraction from real convex refs', () => {
  it('resolves the function path from an anyApi FunctionReference', async () => {
    const sets = setupStore([{ args: {}, value: [] }])
    const { useAutoMutation } = createAutoOptimistic({ graph, api: anyApi })

    const mutate = useAutoMutation(anyApi.tasks.create, () => ({
      kind: 'insert',
      doc: { _id: 'tmp' }
    }))
    await mutate({ title: 't' })

    // If the path had not been extracted, no optimistic write would happen.
    expect(sets).toEqual([{ args: {}, value: [{ _id: 'tmp' }] }])
  })

  it('falls back to the raw mutation with a diagnostic when the path is unknown to the graph', async () => {
    const sets = setupStore([{ args: {}, value: [] }])
    const onDiagnostic = vi.fn()
    const { useAutoMutation } = createAutoOptimistic({ graph, api: anyApi, onDiagnostic })

    const mutate = useAutoMutation(anyApi.tasks.archive, () => ({
      kind: 'delete',
      id: 'x'
    }))
    await mutate({ id: 'x' })

    expect(sets).toHaveLength(0)
    expect(harness.rawCalls).toEqual([{ id: 'x' }])
    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ mutation: 'tasks:archive' })
    )
  })
})

describe('useAutoMutation — codec transforms', () => {
  it('encodes args once, before both the network call and predict()', async () => {
    const sets = setupStore([{ args: {}, value: [] }])
    const seenByPredict: unknown[] = []

    const { useAutoMutation } = createAutoOptimistic({
      graph,
      api: anyApi,
      encodeArgs: (_ref, args) => {
        const a = args as { estimate: { hours: number; minutes: number } }
        return { ...a, estimate: a.estimate.hours * 60 + a.estimate.minutes }
      }
    })

    const mutate = useAutoMutation(anyApi.tasks.create, (args) => {
      seenByPredict.push(args)
      return { kind: 'insert', doc: { _id: 'tmp', ...(args as object) } }
    })
    await mutate({ title: 't', estimate: { hours: 1, minutes: 30 } })

    // The raw mutation must receive wire-shaped args…
    expect(harness.rawCalls).toEqual([{ title: 't', estimate: 90 }])
    // …and predict sees the same wire-shaped args (the store holds wire values).
    expect(seenByPredict).toEqual([{ title: 't', estimate: 90 }])
    expect(sets).toEqual([{ args: {}, value: [{ _id: 'tmp', title: 't', estimate: 90 }] }])
  })

  it('decodes the mutation result when decodeResult is provided', async () => {
    setupStore([])
    harness.serverResult = 12345

    const { useAutoMutation } = createAutoOptimistic({
      graph,
      api: anyApi,
      decodeResult: (_ref, result) => new Date(result as number)
    })

    const mutate = useAutoMutation(anyApi.tasks.create, () => null)
    const result = await mutate({ title: 't' })

    expect(result).toEqual(new Date(12345))
  })

  it('passes args and result through unchanged when no transforms are given', async () => {
    setupStore([])
    const { useAutoMutation } = createAutoOptimistic({ graph, api: anyApi })

    const mutate = useAutoMutation(anyApi.tasks.create, () => null)
    const result = await mutate({ title: 't' })

    expect(harness.rawCalls).toEqual([{ title: 't' }])
    expect(result).toBe('server-result')
  })
})
