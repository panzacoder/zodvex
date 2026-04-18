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
