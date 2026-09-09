import { describe, expect, test } from 'vitest'
import {
  SecretText, assertWireResult, decodeRow, encodeRow, expectedWireResult,
  makeWireRow, processRows, processWireRows, type WireRow,
} from './workload.js'

const source = [
  {
    _id: 'first', _creationTime: 123, seq: 2, createdAt: 1000, secret: 'ab',
    payload: 'xyz', tags: ['t'], checkpoints: [{ at: 400, value: 7 }], reviewedAt: null,
  },
  {
    _id: 'second', _creationTime: 456, seq: 5, createdAt: 2500, secret: 'z',
    payload: 'pq', tags: ['x', 'yz'], checkpoints: [],
  },
] satisfies Array<WireRow & { _id: string; _creationTime: number }>

// Hand-calculated digest: 2 rows + 1 * 2729 + 2 * 4450 = 11631.
const wanted = {
  rows: [
    { ...source[0], createdAt: 2000, secret: 'AB' },
    { ...source[1], createdAt: 3500, secret: 'Z' },
  ],
  digest: 11631,
}

describe('capacity workload', () => {
  test('uses runtime codecs, advances time once and preserves every other wire field', () => {
    const before = JSON.stringify(source)
    const decoded = source.map(decodeRow)
    expect(decoded[0].createdAt).toBeInstanceOf(Date)
    expect(decoded[0].checkpoints[0].at).toBeInstanceOf(Date)
    expect(decoded[0].secret).toBeInstanceOf(SecretText)
    const result = processRows(decoded)
    expect({ rows: result.rows.map(encodeRow), digest: result.digest }).toEqual(wanted)
    expect(decoded[0].createdAt.getTime()).toBe(1000)
    expect(decoded[0].secret.expose()).toBe('ab')
    expect(JSON.stringify(source)).toBe(before)
  })

  test('native wire path and independent oracle agree with a hand-calculated result', () => {
    expect(processWireRows(source)).toEqual(wanted)
    expect(expectedWireResult(source)).toEqual(wanted)
    expect(() => assertWireResult(source, wanted)).not.toThrow()
    expect(processRows([])).toEqual({ rows: [], digest: 0 })
    expect(processWireRows([])).toEqual({ rows: [], digest: 0 })
  })

  test('seed rows are repeatable ASCII payloads and round-trip optional codec states', () => {
    const rows = [0, 1, 2, 3].map(seq => ({
      ...makeWireRow(seq, 1024), _id: `id-${seq}`, _creationTime: seq + 10,
    }))
    expect(rows.map(row => row.payload.length)).toEqual([1024, 1024, 1024, 1024])
    expect(rows.every(row => /^[\x20-\x7e]*$/.test(row.payload))).toBe(true)
    expect(rows[0]).not.toHaveProperty('reviewedAt')
    expect(rows[1].reviewedAt).toBeNull()
    expect(typeof rows[2].reviewedAt).toBe('number')
    expect(rows[0].payload).not.toBe(rows[1].payload)
    expect(makeWireRow(2, 1024)).toEqual(makeWireRow(2, 1024))
    expect(rows.map(decodeRow).map(encodeRow)).toEqual(rows)
    const actual = processRows(rows.map(decodeRow))
    expect(() => assertWireResult(rows, {
      rows: actual.rows.map(encodeRow), digest: actual.digest,
    })).not.toThrow()
  })

  test.each([
    ['payload', (row: typeof wanted.rows[number]) => ({ ...row, payload: 'bad' })],
    ['ID', (row: typeof wanted.rows[number]) => ({ ...row, _id: 'wrong' })],
    ['checkpoint', (row: typeof wanted.rows[number]) => ({ ...row, checkpoints: [] })],
    ['missing field', (row: typeof wanted.rows[number]) => {
      const { tags: _tags, ...rest } = row
      return rest
    }],
  ])('oracle rejects %s corruption even with the expected digest', (_label, corrupt) => {
    expect(() => assertWireResult(source, {
      ...wanted, rows: [corrupt(wanted.rows[0]), wanted.rows[1]],
    })).toThrow()
  })

  test('oracle rejects changed digest, row order and a dropped row', () => {
    expect(() => assertWireResult(source, { ...wanted, digest: 0 })).toThrow()
    expect(() => assertWireResult(source, { ...wanted, rows: [...wanted.rows].reverse() })).toThrow()
    expect(() => assertWireResult(source, { ...wanted, rows: wanted.rows.slice(1) })).toThrow()
  })

  test('manual codec boundaries reject invalid timestamps and plain secret impostors', () => {
    expect(() => decodeRow({ ...source[0], createdAt: Infinity })).toThrow()
    expect(() => encodeRow({ ...decodeRow(source[0]), createdAt: new Date(NaN) })).toThrow()
    expect(() => encodeRow({
      ...decodeRow(source[0]), secret: { toWire: () => 'ab' } as SecretText,
    })).toThrow()
  })

  test('rejects malformed fixture sizes before allocating payloads', () => {
    for (const value of [-1, 1.5, NaN, Infinity]) {
      expect(() => makeWireRow(value, 10)).toThrow()
      expect(() => makeWireRow(0, value)).toThrow()
    }
    expect(makeWireRow(0, 0).payload).toBe('')
  })
})
