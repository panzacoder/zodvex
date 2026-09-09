/** Rules and audit wrappers must be usable immediately after either entrypoint loads. */

import { describe, expect, it, vi } from 'vitest'
import { ZodvexDatabaseReader, ZodvexDatabaseWriter } from '../src/internal/db'

function makeMinimalReader(): any {
  return {
    system: { get: async () => null, query: () => ({}), normalizeId: () => null },
    normalizeId: () => null,
    get: async () => null,
    query: () => ({})
  }
}

function makeMinimalWriter(): any {
  return {
    ...makeMinimalReader(),
    insert: async () => 'id',
    patch: async () => undefined,
    replace: async () => undefined,
    delete: async () => undefined
  }
}

describe('rules are available synchronously at import', () => {
  it('reader.audit() is callable the first statement after import', () => {
    const reader = new ZodvexDatabaseReader(makeMinimalReader(), {})
    // Must NOT throw "zodvex rules module not yet loaded" — the bug this
    // test pins down. No initialization step or intervening await is required.
    expect(() =>
      reader.audit({
        afterRead: () => {
          /* noop */
        }
      })
    ).not.toThrow()
  })

  it('writer.audit() is callable the first statement after import', () => {
    const writer = new ZodvexDatabaseWriter(makeMinimalWriter(), {})
    expect(() =>
      writer.audit({
        afterWrite: () => {
          /* noop */
        }
      })
    ).not.toThrow()
  })

  it('reader.withRules() is callable the first statement after import', () => {
    const reader = new ZodvexDatabaseReader(makeMinimalReader(), {})
    expect(() => reader.withRules({}, {})).not.toThrow()
  })

  it('writer.withRules() is callable the first statement after import', () => {
    const writer = new ZodvexDatabaseWriter(makeMinimalWriter(), {})
    expect(() => writer.withRules({}, {})).not.toThrow()
  })

  it('chained .withRules().audit() works without intervening await', () => {
    const writer = new ZodvexDatabaseWriter(makeMinimalWriter(), {})
    // This is the shape consumers (e.g., hotpot) want to write inside a
    // withContext input callback. Before the fix, both links in the chain
    // could throw before any microtask had run.
    expect(() =>
      writer.withRules({}, {}).audit({
        afterWrite: () => {
          /* noop */
        }
      })
    ).not.toThrow()
  })
})

// Import each entry first in a fresh module graph. Neither entry may
// rely on another importer having initialized its constructors beforehand.
it.each(['server', 'db'] as const)('supports %s-first imports', async first => {
  vi.resetModules()
  const entry =
    first === 'server' ? await import('../src/server') : await import('../src/internal/db')
  const { ZodvexDatabaseReader: Reader, ZodvexDatabaseWriter: Writer } = await import(
    '../src/internal/db'
  )
  const server = await import('../src/server')
  expect(server.ZodvexDatabaseReader).toBe(Reader)
  expect(server.ZodvexDatabaseWriter).toBe(Writer)
  expect(entry.ZodvexDatabaseReader).toBe(Reader)
  expect(entry.ZodvexDatabaseWriter).toBe(Writer)
  const writer = new entry.ZodvexDatabaseWriter(makeMinimalWriter(), {})
  const wrapped = writer.withRules({}, {}).audit({ afterWrite: () => undefined })
  expect(wrapped).toBeInstanceOf(Writer)
  expect(wrapped).toBeInstanceOf(Reader)
  expect(wrapped.system).toBe(writer.system)
})
