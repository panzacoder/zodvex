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
 * The fix: rules.ts no longer references db.ts values at module init.
 * db.ts calls `installRulesSubclasses` at the end of its own module load,
 * fully synchronously. After importing zodvex's internal db module, the
 * rules surface is ready immediately.
 *
 * These tests exercise calling `.audit()` and `.withRules()` the first
 * statement after import — the pattern that was previously broken.
 */

import { describe, expect, it } from 'vitest'
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

describe('rules module is installed synchronously at import', () => {
  it('reader.audit() is callable the first statement after import', () => {
    const reader = new ZodvexDatabaseReader(makeMinimalReader(), {})
    // Must NOT throw "zodvex rules module not yet loaded" — the bug this
    // test pins down. If it throws, the subclass installer never ran
    // before this call.
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
