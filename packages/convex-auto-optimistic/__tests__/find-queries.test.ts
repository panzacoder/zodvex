import { describe, expect, it } from 'vitest'
import {
  findAffectedQueryPaths,
  resolveAffectedQueries,
  resolveInsertPlacement,
  resolveRefFromPath
} from '../src/find-queries'
import type { TableGraphLike } from '../src/types'

const graph: TableGraphLike = {
  functions: {
    'tasks:list': {
      kind: 'query',
      visibility: 'public',
      reads: ['tasks'],
      writes: []
    },
    'tasks:byStatus': {
      kind: 'query',
      visibility: 'public',
      reads: ['tasks'],
      writes: []
    },
    'tasks:create': {
      kind: 'mutation',
      visibility: 'public',
      reads: [],
      writes: ['tasks']
    },
    'tasks:archive': {
      kind: 'mutation',
      visibility: 'public',
      reads: ['tasks'],
      writes: ['tasks', 'auditLog']
    },
    'tasks:internalRead': {
      kind: 'internalQuery',
      visibility: 'internal',
      reads: ['tasks'],
      writes: []
    },
    'users:list': {
      kind: 'query',
      visibility: 'public',
      reads: ['users'],
      writes: []
    },
    'auditLog:list': {
      kind: 'query',
      visibility: 'public',
      reads: ['auditLog'],
      writes: []
    }
  }
}

describe('findAffectedQueryPaths', () => {
  it('returns all public query paths that read a table the mutation writes', () => {
    expect(findAffectedQueryPaths(graph, 'tasks:create')).toEqual(['tasks:byStatus', 'tasks:list'])
  })

  it('returns unioned queries across multiple written tables', () => {
    expect(findAffectedQueryPaths(graph, 'tasks:archive')).toEqual([
      'auditLog:list',
      'tasks:byStatus',
      'tasks:list'
    ])
  })

  it('excludes internal queries (not client-subscribable)', () => {
    const results = findAffectedQueryPaths(graph, 'tasks:create')
    expect(results).not.toContain('tasks:internalRead')
  })

  it('excludes mutations from the affected-queries list', () => {
    const results = findAffectedQueryPaths(graph, 'tasks:create')
    expect(results).not.toContain('tasks:create')
    expect(results).not.toContain('tasks:archive')
  })

  it('returns empty for a mutation path that does not exist', () => {
    expect(findAffectedQueryPaths(graph, 'tasks:missing')).toEqual([])
  })

  it('returns empty for a query path (not a mutation)', () => {
    expect(findAffectedQueryPaths(graph, 'tasks:list')).toEqual([])
  })
})

describe('resolveRefFromPath', () => {
  const api = {
    tasks: {
      list: { _ref: 'tasks:list' },
      create: { _ref: 'tasks:create' }
    },
    users: {
      list: { _ref: 'users:list' }
    },
    api: {
      reports: {
        summary: { _ref: 'api/reports:summary' }
      }
    }
  }

  it('resolves a simple path', () => {
    expect(resolveRefFromPath(api, 'tasks:list')).toBe(api.tasks.list)
  })

  it('resolves a nested path', () => {
    expect(resolveRefFromPath(api, 'api/reports:summary')).toBe(api.api.reports.summary)
  })

  it('returns null for an unknown path', () => {
    expect(resolveRefFromPath(api, 'tasks:doesNotExist')).toBeNull()
  })

  it('returns null for a malformed path (no colon)', () => {
    expect(resolveRefFromPath(api, 'malformed')).toBeNull()
  })

  it('returns null when the namespace is missing', () => {
    expect(resolveRefFromPath(api, 'nothing/here:x')).toBeNull()
  })

  it('returns null for nullish api', () => {
    expect(resolveRefFromPath(null, 'tasks:list')).toBeNull()
    expect(resolveRefFromPath(undefined, 'tasks:list')).toBeNull()
  })
})

describe('resolveAffectedQueries', () => {
  const api = {
    tasks: {
      list: { _ref: 'tasks:list' },
      byStatus: { _ref: 'tasks:byStatus' },
      create: { _ref: 'tasks:create' }
    },
    users: {
      list: { _ref: 'users:list' }
    }
    // `auditLog` omitted intentionally — triggers unresolved case
  }

  it('returns resolved refs and flags unresolvable paths', () => {
    const result = resolveAffectedQueries(graph, api, 'tasks:archive')
    expect(result.resolved.map((r) => r.path)).toEqual(['tasks:byStatus', 'tasks:list'])
    expect(result.unresolved).toEqual(['auditLog:list'])
  })

  it('returns empty lists for a mutation with no affected queries', () => {
    const partialGraph: TableGraphLike = {
      functions: {
        'foo:act': { kind: 'mutation', visibility: 'public', reads: [], writes: ['nobody'] }
      }
    }
    const result = resolveAffectedQueries(partialGraph, api, 'foo:act')
    expect(result.resolved).toEqual([])
    expect(result.unresolved).toEqual([])
  })
})

describe('resolveInsertPlacement', () => {
  function graphWith(
    queryExtras: Partial<TableGraphLike['functions'][string]>,
    mutationWrites: string[] = ['tasks']
  ): TableGraphLike {
    return {
      functions: {
        'tasks:create': {
          kind: 'mutation',
          visibility: 'public',
          reads: [],
          writes: mutationWrites
        },
        'tasks:someList': {
          kind: 'query',
          visibility: 'public',
          reads: mutationWrites,
          writes: [],
          ...queryExtras
        }
      }
    }
  }

  it("returns 'start' for a desc creation-time ordering", () => {
    const g = graphWith({
      resultOrderings: [{ table: 'tasks', direction: 'desc', byCreationTime: true }]
    })
    expect(resolveInsertPlacement(g, 'tasks:create', 'tasks:someList')).toBe('start')
  })

  it("returns 'end' for an asc creation-time ordering", () => {
    const g = graphWith({
      resultOrderings: [{ table: 'tasks', direction: 'asc', byCreationTime: true }]
    })
    expect(resolveInsertPlacement(g, 'tasks:create', 'tasks:someList')).toBe('end')
  })

  it('returns undefined for custom-index orderings (placement unknowable)', () => {
    const g = graphWith({
      resultOrderings: [{ table: 'tasks', direction: 'desc', byCreationTime: false }]
    })
    expect(resolveInsertPlacement(g, 'tasks:create', 'tasks:someList')).toBeUndefined()
  })

  it('returns undefined when the query has no orderings', () => {
    const g = graphWith({})
    expect(resolveInsertPlacement(g, 'tasks:create', 'tasks:someList')).toBeUndefined()
  })

  it('returns undefined for unknown mutation or query paths', () => {
    const g = graphWith({})
    expect(resolveInsertPlacement(g, 'nope:missing', 'tasks:someList')).toBeUndefined()
    expect(resolveInsertPlacement(g, 'tasks:create', 'nope:missing')).toBeUndefined()
  })

  it('requires agreement across all written∩read tables', () => {
    const agree = graphWith(
      {
        resultOrderings: [
          { table: 'tasks', direction: 'desc', byCreationTime: true },
          { table: 'auditLog', direction: 'desc', byCreationTime: true }
        ]
      },
      ['tasks', 'auditLog']
    )
    expect(resolveInsertPlacement(agree, 'tasks:create', 'tasks:someList')).toBe('start')

    const disagree = graphWith(
      {
        resultOrderings: [
          { table: 'tasks', direction: 'desc', byCreationTime: true },
          { table: 'auditLog', direction: 'asc', byCreationTime: true }
        ]
      },
      ['tasks', 'auditLog']
    )
    expect(resolveInsertPlacement(disagree, 'tasks:create', 'tasks:someList')).toBeUndefined()

    const missingOne = graphWith(
      {
        resultOrderings: [{ table: 'tasks', direction: 'desc', byCreationTime: true }]
      },
      ['tasks', 'auditLog']
    )
    expect(resolveInsertPlacement(missingOne, 'tasks:create', 'tasks:someList')).toBeUndefined()
  })

  it('ignores orderings for tables the mutation does not write', () => {
    const g = graphWith({
      reads: ['tasks', 'users'],
      resultOrderings: [
        { table: 'tasks', direction: 'desc', byCreationTime: true },
        { table: 'users', direction: 'asc', byCreationTime: true }
      ]
    })
    expect(resolveInsertPlacement(g, 'tasks:create', 'tasks:someList')).toBe('start')
  })
})
