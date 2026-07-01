import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyze } from '../src/analyze'
import type { TableGraph } from '../src/types'

function fixture(name: string): string {
  return path.join(__dirname, 'fixtures', name, 'convex')
}

function assertFullConfidence(graph: TableGraph, fnPath: string): void {
  const info = graph.functions[fnPath]
  if (!info)
    throw new Error(`Expected ${fnPath} in graph, got: ${Object.keys(graph.functions).join(', ')}`)
  expect(info.confidence, `${fnPath} should have full confidence`).toBe('full')
}

describe('analyze — basic', () => {
  const graph = analyze({ convexDir: fixture('basic') })

  it('discovers all exports', () => {
    expect(Object.keys(graph.functions).sort()).toEqual([
      'tasks:create',
      'tasks:list',
      'tasks:listFirst'
    ])
  })

  it('records reads for query on string literal', () => {
    const fn = graph.functions['tasks:list']!
    expect(fn.kind).toBe('query')
    expect(fn.visibility).toBe('public')
    expect(fn.reads).toEqual(['tasks'])
    expect(fn.writes).toEqual([])
    assertFullConfidence(graph, 'tasks:list')
  })

  it('records writes for insert on string literal', () => {
    const fn = graph.functions['tasks:create']!
    expect(fn.kind).toBe('mutation')
    expect(fn.visibility).toBe('public')
    expect(fn.reads).toEqual([])
    expect(fn.writes).toEqual(['tasks'])
    assertFullConfidence(graph, 'tasks:create')
  })

  it('handles method chains on query results', () => {
    const fn = graph.functions['tasks:listFirst']!
    expect(fn.reads).toEqual(['tasks'])
  })
})

describe('analyze — destructured db', () => {
  const graph = analyze({ convexDir: fixture('destructured') })

  it('handles param-level destructuring ({ db })', () => {
    const fn = graph.functions['tasks:createViaParamDestructure']!
    expect(fn.writes).toEqual(['tasks'])
    assertFullConfidence(graph, 'tasks:createViaParamDestructure')
  })

  it('handles body-level destructuring (const { db } = ctx)', () => {
    const fn = graph.functions['tasks:createViaBodyDestructure']!
    expect(fn.writes).toEqual(['tasks'])
    assertFullConfidence(graph, 'tasks:createViaBodyDestructure')
  })

  it('handles alias assignment (const db2 = ctx.db)', () => {
    const fn = graph.functions['tasks:createViaAlias']!
    expect(fn.writes).toEqual(['tasks'])
    assertFullConfidence(graph, 'tasks:createViaAlias')
  })

  it('handles renamed destructuring (const { db: dbRef } = ctx)', () => {
    const fn = graph.functions['tasks:createViaRenamedDestructure']!
    expect(fn.writes).toEqual(['tasks'])
    assertFullConfidence(graph, 'tasks:createViaRenamedDestructure')
  })
})

describe('analyze — cross-file helpers (taint propagation)', () => {
  const graph = analyze({ convexDir: fixture('helpers') })

  it('follows db through a helper that takes db directly', () => {
    const fn = graph.functions['tasks:createViaHelper']!
    expect(fn.writes).toEqual(['tasks'])
    assertFullConfidence(graph, 'tasks:createViaHelper')
  })

  it('follows ctx through a helper that destructures db from it', () => {
    const fn = graph.functions['tasks:archive']!
    expect(fn.reads).toEqual(['tasks'])
    expect(fn.writes).toEqual(['auditLog'])
    assertFullConfidence(graph, 'tasks:archive')
  })

  it('follows two-hop helper chain', () => {
    const fn = graph.functions['tasks:bulk']!
    expect(fn.writes).toEqual(['tasks'])
    assertFullConfidence(graph, 'tasks:bulk')
  })

  it('does not follow untainted helpers (formatTitle)', () => {
    // If we erroneously walked formatTitle, nothing would break here, but the
    // diagnostics list would grow from unresolved string operations.
    const fn = graph.functions['tasks:createViaHelper']!
    expect(fn.writes).toEqual(['tasks'])
  })
})

describe('analyze — Id<"table"> type resolution', () => {
  const graph = analyze({ convexDir: fixture('id-types') })

  it('resolves patch target from Id type parameter', () => {
    const fn = graph.functions['tasks:archive']!
    expect(fn.writes).toEqual(['tasks'])
  })

  it('resolves delete target from Id type parameter', () => {
    const fn = graph.functions['tasks:remove']!
    expect(fn.writes).toEqual(['tasks'])
  })

  it('resolves replace target from Id type parameter', () => {
    const fn = graph.functions['tasks:replaceDoc']!
    expect(fn.writes).toEqual(['tasks'])
  })

  it('resolves get target from Id type parameter', () => {
    const fn = graph.functions['tasks:fetchById']!
    expect(fn.reads).toEqual(['tasks'])
  })
})

describe('analyze — multi-table', () => {
  const graph = analyze({ convexDir: fixture('multi-table') })

  it('records all tables read', () => {
    const fn = graph.functions['tasks:readTwoTables']!
    expect(fn.reads.sort()).toEqual(['tasks', 'users'])
    expect(fn.writes).toEqual([])
  })

  it('records reads and writes across tables', () => {
    const fn = graph.functions['tasks:archive']!
    expect(fn.reads).toEqual(['tasks'])
    expect(fn.writes.sort()).toEqual(['auditLog', 'tasks'])
  })
})

describe('analyze — default export', () => {
  const graph = analyze({ convexDir: fixture('default-export') })

  it('registers default export under :default', () => {
    expect(Object.keys(graph.functions)).toContain('tasks:default')
    const fn = graph.functions['tasks:default']!
    expect(fn.kind).toBe('query')
    expect(fn.reads).toEqual(['tasks'])
  })
})

describe('analyze — unresolved cases emit diagnostics', () => {
  const graph = analyze({ convexDir: fixture('unresolved') })

  it('marks dynamic table name as partial confidence with a diagnostic', () => {
    const fn = graph.functions['tasks:dynamicRead']!
    expect(fn.confidence).toBe('partial')
    const hasDiag = graph.diagnostics.some((d) => d.function === 'tasks:dynamicRead')
    expect(hasDiag).toBe(true)
  })

  it('does not poison sibling functions in the same file', () => {
    const fn = graph.functions['tasks:goodRead']!
    expect(fn.confidence).toBe('full')
    expect(fn.reads).toEqual(['tasks'])
  })
})

describe('analyze — internal functions', () => {
  const graph = analyze({ convexDir: fixture('internal') })

  it('distinguishes internal from public visibility', () => {
    expect(graph.functions['tasks:publicList']!.visibility).toBe('public')
    expect(graph.functions['tasks:secretList']!.visibility).toBe('internal')
    expect(graph.functions['tasks:publicInsert']!.visibility).toBe('public')
    expect(graph.functions['tasks:secretInsert']!.visibility).toBe('internal')
  })

  it('records kind accurately for internal builders', () => {
    expect(graph.functions['tasks:secretList']!.kind).toBe('internalQuery')
    expect(graph.functions['tasks:secretInsert']!.kind).toBe('internalMutation')
  })
})

describe('analyze — custom wrapper builders via config', () => {
  it('does NOT recognize wrappers without config', () => {
    const graph = analyze({ convexDir: fixture('wrappers') })
    // With default builders, zQuery/zMutation aren't recognized.
    expect(graph.functions).toEqual({})
  })

  it('recognizes zQuery/zMutation when provided in config', () => {
    const graph = analyze({
      convexDir: fixture('wrappers'),
      builders: {
        query: ['zQuery'],
        mutation: ['zMutation']
      }
    })
    expect(graph.functions['tasks:list']!.kind).toBe('query')
    expect(graph.functions['tasks:list']!.reads).toEqual(['tasks'])
    expect(graph.functions['tasks:create']!.kind).toBe('mutation')
    expect(graph.functions['tasks:create']!.writes).toEqual(['tasks'])
  })
})

describe('analyze — db wrapper methods (e.g. withRules)', () => {
  const graph = analyze({ convexDir: fixture('db-wrapper') })

  it('taints the return of an unknown method on db as db', () => {
    const fn = graph.functions['tasks:listWithRules']!
    expect(fn.reads).toEqual(['tasks'])
    assertFullConfidence(graph, 'tasks:listWithRules')
  })

  it('propagates through wrapper for writes', () => {
    const fn = graph.functions['tasks:updateWithRules']!
    expect(fn.writes).toEqual(['tasks'])
    assertFullConfidence(graph, 'tasks:updateWithRules')
  })

  it('handles chained wrappers', () => {
    const fn = graph.functions['tasks:chainedWrappers']!
    expect(fn.reads).toEqual(['tasks'])
    assertFullConfidence(graph, 'tasks:chainedWrappers')
  })
})

describe('analyze — expression-bodied arrow handlers', () => {
  const graph = analyze({ convexDir: fixture('expression-body') })

  it('records read when the db call IS the concise body', () => {
    const fn = graph.functions['tasks:fetchById']!
    expect(fn.reads).toEqual(['tasks'])
    assertFullConfidence(graph, 'tasks:fetchById')
  })

  it('records read when the concise body is a method chain', () => {
    const fn = graph.functions['tasks:list']!
    expect(fn.reads).toEqual(['tasks'])
    assertFullConfidence(graph, 'tasks:list')
  })

  it('records write when the insert call IS the concise body', () => {
    const fn = graph.functions['tasks:create']!
    expect(fn.writes).toEqual(['tasks'])
    assertFullConfidence(graph, 'tasks:create')
  })
})

describe('analyze — table-name-first overloads', () => {
  const graph = analyze({ convexDir: fixture('table-first') })

  it('resolves get from a table-first string literal', () => {
    const fn = graph.functions['tasks:getTask']!
    expect(fn.reads).toEqual(['tasks'])
    assertFullConfidence(graph, 'tasks:getTask')
  })

  it('resolves patch from a table-first string literal', () => {
    const fn = graph.functions['tasks:update']!
    expect(fn.writes).toEqual(['tasks'])
    assertFullConfidence(graph, 'tasks:update')
  })

  it('resolves replace from a table-first string literal', () => {
    const fn = graph.functions['tasks:replaceDoc']!
    expect(fn.writes).toEqual(['tasks'])
    assertFullConfidence(graph, 'tasks:replaceDoc')
  })

  it('resolves delete from a table-first string literal', () => {
    const fn = graph.functions['tasks:remove']!
    expect(fn.writes).toEqual(['tasks'])
    assertFullConfidence(graph, 'tasks:remove')
  })

  it('still resolves the id-first overload from the Id type', () => {
    const fn = graph.functions['tasks:removeById']!
    expect(fn.writes).toEqual(['tasks'])
    assertFullConfidence(graph, 'tasks:removeById')
  })
})

describe('analyze — string-literal propagation into parametric helpers', () => {
  const graph = analyze({ convexDir: fixture('param-tables') })

  it('resolves a table name passed as a helper argument', () => {
    const fn = graph.functions['tasks:touch']!
    expect(fn.reads).toEqual(['tasks'])
    assertFullConfidence(graph, 'tasks:touch')
  })

  it('records both tables when the same helper is called with different literals', () => {
    const fn = graph.functions['tasks:touchTwo']!
    expect(fn.reads.sort()).toEqual(['tasks', 'users'])
    assertFullConfidence(graph, 'tasks:touchTwo')
  })

  it('resolves query/patch/insert on a parametric table inside a helper', () => {
    const fn = graph.functions['tasks:save']!
    expect(fn.reads).toEqual(['tasks'])
    expect(fn.writes).toEqual(['tasks'])
    assertFullConfidence(graph, 'tasks:save')
  })

  it('propagates the literal through a two-hop helper chain', () => {
    const fn = graph.functions['tasks:touchDeep']!
    expect(fn.reads).toEqual(['tasks'])
    assertFullConfidence(graph, 'tasks:touchDeep')
  })
})

describe('analyze — depth limit', () => {
  it('emits diagnostic when max depth is exceeded', () => {
    // Default depth of 3 — handler(0) -> level1(1) -> level2(2) -> level3(3) -> level4(4)
    // The call from level3 to level4 should be blocked.
    const graph = analyze({ convexDir: fixture('depth') })
    const fn = graph.functions['tasks:deep']!
    expect(fn.confidence).toBe('partial')
    const depthDiag = graph.diagnostics.find((d) => d.code === 'max-depth')
    expect(depthDiag).toBeDefined()
  })

  it('succeeds when max depth is increased', () => {
    const graph = analyze({ convexDir: fixture('depth'), maxDepth: 5 })
    const fn = graph.functions['tasks:deep']!
    expect(fn.confidence).toBe('full')
    expect(fn.writes).toEqual(['tasks'])
  })
})
