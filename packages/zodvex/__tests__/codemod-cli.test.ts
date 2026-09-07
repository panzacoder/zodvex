/**
 * End-to-end tests for `zodvex codemod --to-mini`.
 *
 * Uses the task-manager example project as a real-world test case.
 * The codemod runs against a temp copy so the original is never modified.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const TASK_MANAGER_CONVEX = join(__dirname, '../../../examples/task-manager/convex')

describe('zodvex codemod --to-mini', () => {
  let tempDir: string

  beforeEach(() => {
    // Copy task-manager's convex/ to a temp directory
    tempDir = mkdtempSync(join(tmpdir(), 'zodvex-codemod-test-'))
    const convexDir = join(tempDir, 'convex')
    cpSync(TASK_MANAGER_CONVEX, convexDir, {
      recursive: true,
      filter: src => {
        // Skip _generated and _zodvex — not needed for codemod test
        const rel = src.replace(TASK_MANAGER_CONVEX, '')
        return !rel.includes('_generated') && !rel.includes('_zodvex')
      }
    })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('transforms full-zod imports to zod/mini', async () => {
    const { runToMiniCodemod } = await import('../src/public/cli/codemod')
    await runToMiniCodemod(join(tempDir, 'convex'), { dryRun: false })

    const task = readFileSync(join(tempDir, 'convex/models/task.ts'), 'utf-8')
    expect(task).toContain("from 'zod/mini'")
    expect(task).not.toContain("from 'zod'")
  })

  it('transforms canonical client-safe zodvex imports to zodvex/mini', async () => {
    const { runToMiniCodemod } = await import('../src/public/cli/codemod')
    await runToMiniCodemod(join(tempDir, 'convex'), { dryRun: false })

    const task = readFileSync(join(tempDir, 'convex/models/task.ts'), 'utf-8')
    expect(task).toContain("from 'zodvex/mini'")
    expect(task).not.toContain("from 'zodvex/core'")
    expect(task).not.toContain("from 'zodvex'")
  })

  it('transforms .optional() to z.optional()', async () => {
    const { runToMiniCodemod } = await import('../src/public/cli/codemod')
    await runToMiniCodemod(join(tempDir, 'convex'), { dryRun: false })

    const task = readFileSync(join(tempDir, 'convex/models/task.ts'), 'utf-8')
    // z.string().optional() → z.optional(z.string())
    expect(task).toContain('z.optional(z.string())')
    expect(task).not.toMatch(/z\.string\(\)\.optional\(\)/)
  })

  it('transforms .nullable() to z.nullable()', async () => {
    const { runToMiniCodemod } = await import('../src/public/cli/codemod')
    await runToMiniCodemod(join(tempDir, 'convex'), { dryRun: false })

    const task = readFileSync(join(tempDir, 'convex/models/task.ts'), 'utf-8')
    // z.enum([...]).nullable() → z.nullable(z.enum([...]))
    expect(task).toContain('z.nullable(')
    expect(task).not.toMatch(/\.nullable\(\)/)
  })

  it('dry-run does not modify files', async () => {
    const before = readFileSync(join(tempDir, 'convex/models/task.ts'), 'utf-8')

    const { runToMiniCodemod } = await import('../src/public/cli/codemod')
    await runToMiniCodemod(join(tempDir, 'convex'), { dryRun: true })

    const after = readFileSync(join(tempDir, 'convex/models/task.ts'), 'utf-8')
    expect(after).toBe(before)
  })

  it('skips _generated and _zodvex directories', async () => {
    const source = "import { z } from 'zod'; export const schema = z.string().optional();"
    for (const dir of ['_generated', '_zodvex']) {
      const path = join(tempDir, 'convex', dir)
      mkdirSync(path)
      writeFileSync(join(path, 'sentinel.ts'), source)
    }
    const { runToMiniCodemod } = await import('../src/public/cli/codemod')
    await runToMiniCodemod(join(tempDir, 'convex'), { dryRun: false })
    for (const dir of ['_generated', '_zodvex']) {
      expect(readFileSync(join(tempDir, 'convex', dir, 'sentinel.ts'), 'utf-8')).toBe(source)
    }
  })
})
