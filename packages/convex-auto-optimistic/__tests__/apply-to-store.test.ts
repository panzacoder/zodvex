import { describe, expect, it, vi } from 'vitest'
import { applyPredictionToStore, type LocalStoreLike } from '../src/apply-to-store'
import type { TableGraphLike } from '../src/types'

const graph: TableGraphLike = {
  functions: {
    'tasks:list': { kind: 'query', visibility: 'public', reads: ['tasks'], writes: [] },
    'tasks:byStatus': { kind: 'query', visibility: 'public', reads: ['tasks'], writes: [] },
    'tasks:create': { kind: 'mutation', visibility: 'public', reads: [], writes: ['tasks'] },
    'tasks:update': { kind: 'mutation', visibility: 'public', reads: [], writes: ['tasks'] }
  }
}

type FakeRef = { _name: string }

function makeApi(): Record<string, Record<string, FakeRef>> {
  return {
    tasks: {
      list: { _name: 'tasks:list' },
      byStatus: { _name: 'tasks:byStatus' },
      create: { _name: 'tasks:create' },
      update: { _name: 'tasks:update' }
    }
  }
}

function makeStore(initialEntries: Map<unknown, Array<{ args: unknown; value: unknown }>>): {
  store: LocalStoreLike
  sets: Array<{ ref: unknown; args: unknown; value: unknown }>
} {
  const sets: Array<{ ref: unknown; args: unknown; value: unknown }> = []
  const store: LocalStoreLike = {
    getAllQueries: (ref: unknown) => initialEntries.get(ref) ?? [],
    setQuery: (ref, args, value) => {
      sets.push({ ref, args, value })
    }
  }
  return { store, sets }
}

describe('applyPredictionToStore — insert', () => {
  it('appends doc to every cached list-query entry', () => {
    const api = makeApi()
    const listRef = api.tasks!.list
    const byStatusRef = api.tasks!.byStatus

    const entries = new Map<unknown, Array<{ args: unknown; value: unknown }>>([
      [listRef, [{ args: {}, value: [{ _id: '1', title: 'existing' }] }]],
      [byStatusRef, [{ args: { status: 'todo' }, value: [{ _id: '1', title: 'existing' }] }]]
    ])

    const { store, sets } = makeStore(entries)

    applyPredictionToStore(
      store,
      { kind: 'insert', doc: { _id: 'new', title: 'optimistic' } },
      {
        graph,
        apiRoot: api,
        mutationPath: 'tasks:create'
      }
    )

    expect(sets).toHaveLength(2)
    expect(sets[0]).toEqual({
      ref: byStatusRef,
      args: { status: 'todo' },
      value: [
        { _id: '1', title: 'existing' },
        { _id: 'new', title: 'optimistic' }
      ]
    })
    expect(sets[1]).toEqual({
      ref: listRef,
      args: {},
      value: [
        { _id: '1', title: 'existing' },
        { _id: 'new', title: 'optimistic' }
      ]
    })
  })

  it('skips queries with undefined cached values', () => {
    const api = makeApi()
    const listRef = api.tasks!.list
    const entries = new Map<unknown, Array<{ args: unknown; value: unknown }>>([
      [listRef, [{ args: {}, value: undefined }]]
    ])
    const { store, sets } = makeStore(entries)

    applyPredictionToStore(
      store,
      { kind: 'insert', doc: { _id: 'x' } },
      { graph, apiRoot: api, mutationPath: 'tasks:create' }
    )

    expect(sets).toHaveLength(0)
  })
})

describe('applyPredictionToStore — patch', () => {
  it('updates matching docs across all affected queries', () => {
    const api = makeApi()
    const listRef = api.tasks!.list
    const entries = new Map<unknown, Array<{ args: unknown; value: unknown }>>([
      [
        listRef,
        [
          {
            args: {},
            value: [
              { _id: 'a', title: 'A' },
              { _id: 'b', title: 'B' }
            ]
          }
        ]
      ]
    ])
    const { store, sets } = makeStore(entries)

    applyPredictionToStore(
      store,
      { kind: 'patch', id: 'b', changes: { title: 'B prime' } },
      { graph, apiRoot: api, mutationPath: 'tasks:update' }
    )

    expect(sets).toHaveLength(1)
    expect(sets[0]?.value).toEqual([
      { _id: 'a', title: 'A' },
      { _id: 'b', title: 'B prime' }
    ])
  })

  it('does not write when nothing changes', () => {
    const api = makeApi()
    const listRef = api.tasks!.list
    const entries = new Map<unknown, Array<{ args: unknown; value: unknown }>>([
      [listRef, [{ args: {}, value: [{ _id: 'a', title: 'A' }] }]]
    ])
    const { store, sets } = makeStore(entries)

    applyPredictionToStore(
      store,
      { kind: 'patch', id: 'missing', changes: { title: 'x' } },
      { graph, apiRoot: api, mutationPath: 'tasks:update' }
    )

    expect(sets).toHaveLength(0)
  })
})

describe('applyPredictionToStore — diagnostics', () => {
  it('reports unresolved query paths', () => {
    const partialApi = { tasks: { create: { _name: 'tasks:create' } } } // no list/byStatus
    const entries = new Map<unknown, Array<{ args: unknown; value: unknown }>>()
    const { store } = makeStore(entries)

    const onDiagnostic = vi.fn()
    applyPredictionToStore(
      store,
      { kind: 'insert', doc: { _id: 'x' } },
      {
        graph,
        apiRoot: partialApi,
        mutationPath: 'tasks:create',
        onDiagnostic
      }
    )

    expect(onDiagnostic).toHaveBeenCalledTimes(2)
    const messages = onDiagnostic.mock.calls.map((c) => c[0].query)
    expect(messages).toEqual(expect.arrayContaining(['tasks:list', 'tasks:byStatus']))
  })

  it('reports getAllQueries failures without aborting other queries', () => {
    const api = makeApi()
    const listRef = api.tasks!.list
    const byStatusRef = api.tasks!.byStatus

    const store: LocalStoreLike = {
      getAllQueries: (ref: unknown) => {
        if (ref === byStatusRef) throw new Error('simulated failure')
        return [{ args: {}, value: [{ _id: 'x' }] }]
      },
      setQuery: vi.fn()
    }

    const onDiagnostic = vi.fn()
    applyPredictionToStore(
      store,
      { kind: 'insert', doc: { _id: 'new' } },
      {
        graph,
        apiRoot: api,
        mutationPath: 'tasks:create',
        onDiagnostic
      }
    )

    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ query: 'tasks:byStatus' }))
    // The other query should still have been processed.
    expect(store.setQuery).toHaveBeenCalled()
  })
})
