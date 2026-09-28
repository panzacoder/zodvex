import assert from 'node:assert/strict'

export function assertResult(value, { kind, fixture, tables, nonce }) {
  const initialized = (kind === 'helpers' ? ['helper-init:probe'] :
    (kind === 'static' ? fixture.names : tables).map(name => `model-init:${name}`)).sort()
  assert.equal(value.nonce, nonce)
  assert.deepEqual(value.before, kind === 'dynamic' ? [] : initialized)
  assert.deepEqual(value.after, initialized)
  assert.deepEqual(value.touched, tables)
  assert.equal(value.liveFields, tables.length * 32)
  assert.equal(value.registryChecksum, kind === 'helpers' ? 0 : fixture.total * (kind === 'static' ? 40 : 8))
  assert.deepEqual(value.results, tables.map(() => ({
    date: 1700000001000, secret: 'ITEM-1', nestedDate: 1700000002002,
    nestedSecret: 'item-6', arrayNumber: 3, roundTrip: true,
    invalidInputRejected: true, invalidUnionRejected: true, invalidOutputRejected: true, wireValidInvalidInputRejected: true,
  })))
}

export function parseGc(excerpt) {
  return excerpt.split('\n').flatMap(line => {
    const at = line.indexOf('GC: {')
    if (at < 0) return []
    try {
      const event = JSON.parse(line.slice(at + 4).trim())
      return event.reason === 'testing'
        ? [{ identity: line.slice(0, at).match(/^\[[^\]]+\]/)?.[0], ...event }] : []
    } catch { return [] }
  })
}

export function retainedBytes(records) {
  assert.ok(records.length >= 2, 'At least two testing GC events required')
  assert.equal(new Set(records.map(row => row.identity)).size, 1, 'One isolate per observation required')
  for (const row of records) {
    assert.ok(row.identity)
    assert.equal(row.gc, 'mc')
    assert.ok(Number.isFinite(row.end_object_size) && row.end_object_size > 0)
  }
  return records.at(-1).end_object_size
}
