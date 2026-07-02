import { describe, expect, it } from 'vitest'
import { applyPrediction } from '../src/apply-prediction'

const task = (id: string, extras: Record<string, unknown> = {}): Record<string, unknown> => ({
  _id: id,
  _creationTime: 1,
  title: 'task',
  ...extras
})

describe('applyPrediction — undefined result', () => {
  it('returns undefined (query not loaded)', () => {
    expect(applyPrediction(undefined, { kind: 'insert', doc: task('x') })).toBeUndefined()
    expect(applyPrediction(undefined, { kind: 'patch', id: 'x', changes: {} })).toBeUndefined()
    expect(applyPrediction(undefined, { kind: 'delete', id: 'x' })).toBeUndefined()
  })
})

describe('applyPrediction — insert', () => {
  it('appends to an array', () => {
    const before = [task('1'), task('2')]
    const after = applyPrediction(before, { kind: 'insert', doc: task('3') })
    expect(after).toEqual([task('1'), task('2'), task('3')])
  })

  it('does not duplicate when doc with same _id already exists', () => {
    const before = [task('1')]
    const after = applyPrediction(before, { kind: 'insert', doc: task('1') })
    expect(after).toBe(before)
  })

  it('replaces null with the new doc (first/unique-style query)', () => {
    const after = applyPrediction(null, { kind: 'insert', doc: task('1') })
    expect(after).toEqual(task('1'))
  })

  it('does not modify paginated results (filter semantics unknown)', () => {
    const before = { page: [task('1')], isDone: false, continueCursor: 'c1' }
    const after = applyPrediction(before, { kind: 'insert', doc: task('2') })
    expect(after).toBe(before)
  })

  it('leaves unknown shapes untouched', () => {
    const before = { foo: 'bar' }
    const after = applyPrediction(before, { kind: 'insert', doc: task('1') })
    expect(after).toBe(before)
  })
})

describe('applyPrediction — insert placement (`at`)', () => {
  it("prepends to an array when at is 'start'", () => {
    const before = [task('1'), task('2')]
    const after = applyPrediction(before, { kind: 'insert', doc: task('3'), at: 'start' })
    expect(after).toEqual([task('3'), task('1'), task('2')])
  })

  it("prepends to the first page when at is 'start' and the cursor is null", () => {
    const before = { page: [task('1')], isDone: false, continueCursor: 'c1' }
    const after = applyPrediction(
      before,
      { kind: 'insert', doc: task('2'), at: 'start' },
      { queryArgs: { paginationOpts: { numItems: 10, cursor: null } } }
    )
    expect(after).toEqual({
      page: [task('2'), task('1')],
      isDone: false,
      continueCursor: 'c1'
    })
  })

  it("leaves non-first pages unchanged when at is 'start'", () => {
    const before = { page: [task('1')], isDone: false, continueCursor: 'c2' }
    const after = applyPrediction(
      before,
      { kind: 'insert', doc: task('2'), at: 'start' },
      { queryArgs: { paginationOpts: { numItems: 10, cursor: 'c1' } } }
    )
    expect(after).toBe(before)
  })

  it("leaves paginated results unchanged when at is 'start' but no paginationOpts in args", () => {
    const before = { page: [task('1')], isDone: false, continueCursor: 'c1' }
    const after = applyPrediction(
      before,
      { kind: 'insert', doc: task('2'), at: 'start' },
      { queryArgs: {} }
    )
    expect(after).toBe(before)
  })

  it("appends to the final page when at is 'end' and isDone", () => {
    const before = { page: [task('1')], isDone: true, continueCursor: 'c1' }
    const after = applyPrediction(
      before,
      { kind: 'insert', doc: task('2'), at: 'end' },
      { queryArgs: { paginationOpts: { numItems: 10, cursor: 'c1' } } }
    )
    expect(after).toEqual({
      page: [task('1'), task('2')],
      isDone: true,
      continueCursor: 'c1'
    })
  })

  it("leaves non-final pages unchanged when at is 'end'", () => {
    const before = { page: [task('1')], isDone: false, continueCursor: 'c1' }
    const after = applyPrediction(
      before,
      { kind: 'insert', doc: task('2'), at: 'end' },
      { queryArgs: { paginationOpts: { numItems: 10, cursor: null } } }
    )
    expect(after).toBe(before)
  })

  it('does not duplicate on paginated insert when the doc is already in the page', () => {
    const before = { page: [task('1')], isDone: false, continueCursor: 'c1' }
    const after = applyPrediction(
      before,
      { kind: 'insert', doc: task('1'), at: 'start' },
      { queryArgs: { paginationOpts: { numItems: 10, cursor: null } } }
    )
    expect(after).toBe(before)
  })
})

describe('applyPrediction — usePaginatedQuery internal variants', () => {
  // convex/react's usePaginatedQuery issues internal queries whose
  // paginationOpts carry an extra `id` field, and identifies the first page
  // by `cursor === null` (see use_paginated_query.ts). Lock compatibility.
  it("prepends to the first page when args carry usePaginatedQuery's extra id field", () => {
    const before = { page: [task('1')], isDone: false, continueCursor: 'c1' }
    const after = applyPrediction(
      before,
      { kind: 'insert', doc: task('2'), at: 'start' },
      { queryArgs: { paginationOpts: { numItems: 5, cursor: null, id: 1 } } }
    )
    expect(after).toEqual({
      page: [task('2'), task('1')],
      isDone: false,
      continueCursor: 'c1'
    })
  })

  it('leaves grown (non-first) usePaginatedQuery pages unchanged', () => {
    const before = { page: [task('1')], isDone: true, continueCursor: 'c2' }
    const after = applyPrediction(
      before,
      { kind: 'insert', doc: task('2'), at: 'start' },
      { queryArgs: { paginationOpts: { numItems: 5, cursor: 'c1', id: 1 } } }
    )
    expect(after).toBe(before)
  })

  it('recognizes pagination results carrying extra fields and preserves them', () => {
    const before = {
      page: [task('1')],
      isDone: false,
      continueCursor: 'c1',
      splitCursor: 's1',
      pageStatus: 'SplitRecommended'
    }
    const inserted = applyPrediction(
      before,
      { kind: 'insert', doc: task('2'), at: 'start' },
      { queryArgs: { paginationOpts: { numItems: 5, cursor: null, id: 1 } } }
    )
    expect(inserted).toEqual({ ...before, page: [task('2'), task('1')] })

    const patched = applyPrediction(before, {
      kind: 'patch',
      id: '1',
      changes: { title: 'updated' }
    })
    expect(patched).toEqual({ ...before, page: [task('1', { title: 'updated' })] })

    const deleted = applyPrediction(before, { kind: 'delete', id: '1' })
    expect(deleted).toEqual({ ...before, page: [] })
  })
})

describe('applyPrediction — patch', () => {
  it('updates the matching doc in an array', () => {
    const before = [task('1'), task('2', { title: 'two' })]
    const after = applyPrediction(before, { kind: 'patch', id: '2', changes: { title: 'updated' } })
    expect(after).toEqual([task('1'), task('2', { title: 'updated' })])
  })

  it('returns the same array reference if no doc matches', () => {
    const before = [task('1'), task('2')]
    const after = applyPrediction(before, { kind: 'patch', id: '99', changes: { title: 'x' } })
    expect(after).toBe(before)
  })

  it('updates a single-doc result when _id matches', () => {
    const before = task('1', { title: 'old' })
    const after = applyPrediction(before, { kind: 'patch', id: '1', changes: { title: 'new' } })
    expect(after).toEqual(task('1', { title: 'new' }))
  })

  it('returns null unchanged when the target doc is absent', () => {
    const after = applyPrediction(null, { kind: 'patch', id: 'x', changes: {} })
    expect(after).toBeNull()
  })

  it('applies changes through paginated results', () => {
    const before = {
      page: [task('1'), task('2', { title: 'two' })],
      isDone: false,
      continueCursor: 'c1'
    }
    const after = applyPrediction(before, {
      kind: 'patch',
      id: '2',
      changes: { title: 'updated' }
    })
    expect(after).toEqual({
      page: [task('1'), task('2', { title: 'updated' })],
      isDone: false,
      continueCursor: 'c1'
    })
  })
})

describe('applyPrediction — delete', () => {
  it('removes the matching doc from an array', () => {
    const before = [task('1'), task('2'), task('3')]
    const after = applyPrediction(before, { kind: 'delete', id: '2' })
    expect(after).toEqual([task('1'), task('3')])
  })

  it('returns the same array reference if no doc matches', () => {
    const before = [task('1'), task('2')]
    const after = applyPrediction(before, { kind: 'delete', id: '99' })
    expect(after).toBe(before)
  })

  it('replaces a matching single-doc result with null', () => {
    const before = task('1')
    const after = applyPrediction(before, { kind: 'delete', id: '1' })
    expect(after).toBeNull()
  })

  it('leaves non-matching single-doc result unchanged', () => {
    const before = task('1')
    const after = applyPrediction(before, { kind: 'delete', id: '2' })
    expect(after).toBe(before)
  })

  it('removes from paginated page', () => {
    const before = {
      page: [task('1'), task('2')],
      isDone: false,
      continueCursor: 'c1'
    }
    const after = applyPrediction(before, { kind: 'delete', id: '2' })
    expect(after).toEqual({
      page: [task('1')],
      isDone: false,
      continueCursor: 'c1'
    })
  })
})
