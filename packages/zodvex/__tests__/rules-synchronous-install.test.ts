/**
 * Regression test for the rules-module lazy-load race.
 *
 * Previously, rules.ts was loaded via `dynamic import()` from db.ts to break
 * a circular dependency. This meant `.withRules()` / `.audit()` could only
 * be called AFTER the import promise resolved — and anything that wired up
 * those wrappers synchronously at mutation registration time (e.g.,
 * `zim.withContext`'s input function running at module init) would throw
 * "zodvex rules module not yet loaded".
 *
 * The base classes and rule/audit subclasses are declared in the same module.
 * Both DB and rules imports therefore expose ready constructors synchronously.
 *
 * These tests exercise calling `.audit()` and `.withRules()` the first
 * statement after import — the pattern that was previously broken.
 */

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

// Import each internal entry first in a fresh module graph. Neither entry may
// rely on another importer having initialized its constructors beforehand.
it.each(['rules', 'db'] as const)('supports %s-first imports', async first => {
  vi.resetModules()
  const entry =
    first === 'rules' ? await import('../src/internal/rules') : await import('../src/internal/db')
  if (first === 'rules') {
    expect('RulesQueryChain' in entry && typeof entry.RulesQueryChain).toBe('function')
  }
  const { ZodvexDatabaseReader: Reader, ZodvexDatabaseWriter: Writer } = await import(
    '../src/internal/db'
  )
  const writer = new Writer(makeMinimalWriter(), {})
  const wrapped = writer.withRules({}, {}).audit({ afterWrite: () => undefined })
  expect(wrapped).toBeInstanceOf(Writer)
  expect(wrapped).toBeInstanceOf(Reader)
  expect(wrapped.system).toBe(writer.system)
})
