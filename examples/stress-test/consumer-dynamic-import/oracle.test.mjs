import { expect, test } from 'vitest'
import { assertResult, parseGc, retainedBytes } from './oracle.mjs'

const fixture = { total: 65, names: Array.from({ length: 65 }, (_, i) => `model${String(i).padStart(3, '0')}`) }
function result() {
  return { nonce: 'sample', before: [], after: ['model-init:model000'], touched: ['model000'],
    liveFields: 32, registryChecksum: 520, results: [{ date: 1700000001000, secret: 'ITEM-1',
      nestedDate: 1700000002002, nestedSecret: 'item-6', arrayNumber: 3, roundTrip: true,
      invalidInputRejected: true, invalidUnionRejected: true, invalidOutputRejected: true,
      wireValidInvalidInputRejected: true }] }
}
const expected = { kind: 'dynamic', fixture, tables: ['model000'], nonce: 'sample' }

test('runtime module observations catch eager loading despite one requested table', () => {
  assertResult(result(), expected)
  const eager = result()
  eager.after.push('model-init:model001')
  expect(() => assertResult(eager, expected)).toThrow()
})

test('the independent result oracle rejects codec or wire-valid validation regressions', () => {
  for (const property of ['date', 'nestedSecret', 'wireValidInvalidInputRejected']) {
    const incorrect = result()
    incorrect.results[0][property] = false
    expect(() => assertResult(incorrect, expected)).toThrow()
  }
})

test('retained bytes require completed major test GCs from one isolate', () => {
  const event = { reason: 'testing', gc: 'mc', end_object_size: 1234 }
  const line = `[1:0xabc:2] 10 ms: GC: ${JSON.stringify(event)}`
  const records = parseGc(`${line}\n${line}\n[1:0xabc:2] GC: {"reason":"allocation failure"}`)
  expect(retainedBytes(records)).toBe(1234)
  expect(() => retainedBytes(records.slice(0, 1))).toThrow()
  expect(() => retainedBytes([records[0], { ...records[1], identity: '[1:0xabc:3]' }])).toThrow()
  expect(() => retainedBytes([records[0], { ...records[1], gc: 's' }])).toThrow()
  expect(() => retainedBytes([records[0], { ...records[1], end_object_size: 0 }])).toThrow()
})
