/**
 * Integration test: codegen --mini output actually loads and runs.
 *
 * This is the test that would have caught "schema.doc.nullable is not a function"
 * immediately. It imports the generated registry from the mini example and verifies
 * every entry is a valid, parseable schema.
 *
 * Prerequisites: run `bun run generate` in examples/task-manager-mini before tests.
 * The generated _zodvex/api.js is checked into git, so this works out of the box.
 *
 * TODO: Replace the checked-in prerequisite with a task-graph dependency — codegen
 * should be a build step that runs before tests, not a manual/CI step. The test
 * should only consume the output, not produce it.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { safeParse } from 'zod/v4/core'

const apiPath = resolve(__dirname, '../../../../examples/task-manager-mini/convex/_zodvex/api.js')

let registry: Record<string, { args?: any; returns?: any }>

beforeAll(async () => {
  if (!existsSync(apiPath)) {
    throw new Error(
      `Generated api.js not found at ${apiPath}. ` +
        'Run `bun run generate` in examples/task-manager-mini first.'
    )
  }

  // Import the generated output — this is where "schema.doc.nullable is not
  // a function" would throw if codegen emits method chains in mini mode
  const mod = await import(apiPath)
  registry = mod.zodvexRegistry
})

describe('mini codegen e2e: generated registry loads and works', () => {
  it('registry loaded without runtime errors', () => {
    expect(registry).toBeDefined()
    expect(Object.keys(registry).length).toBeGreaterThan(0)
  })

  it('every entry has parseable args schema or no args', () => {
    for (const [path, entry] of Object.entries(registry)) {
      if (entry.args) {
        // safeParse doesn't throw — the schema is structurally valid
        const result = safeParse(entry.args, {})
        expect(result, `${path}: args schema failed safeParse`).toHaveProperty('success')
      }
    }
  })

  it('every entry with returns has a valid zod schema', () => {
    for (const [path, entry] of Object.entries(registry)) {
      if (entry.returns) {
        expect(entry.returns._zod, `${path}: returns is not a zod schema`).toBeDefined()
      }
    }
  })

  it('no method-chain artifacts in loaded schemas', () => {
    // If any schema was constructed via .nullable()/.optional() on a mini object,
    // it would have thrown during import. This test is a belt-and-suspenders check
    // that the registry entries are real schema objects, not error remnants.
    for (const [path, entry] of Object.entries(registry)) {
      if (entry.args) {
        expect(typeof entry.args._zod.def, `${path}: args missing def`).toBe('object')
      }
      if (entry.returns) {
        expect(typeof entry.returns._zod.def, `${path}: returns missing def`).toBe('object')
      }
    }
  })
})
