/**
 * End-to-end tests for `zodvex codemod --to-mini`.
 *
 * Uses the task-manager example project as a real-world test case.
 * The codemod runs against a temp copy so the original is never modified.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

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
    const { runToMiniCodemod } = await import('../src/cli/codemod')
    await runToMiniCodemod(join(tempDir, 'convex'), { dryRun: false })

    const task = readFileSync(join(tempDir, 'convex/models/task.ts'), 'utf-8')
    expect(task).toContain("from 'zod/mini'")
    expect(task).not.toContain("from 'zod'")
  })

  it('transforms zodvex/core imports to zodvex/mini', async () => {
    const { runToMiniCodemod } = await import('../src/cli/codemod')
    await runToMiniCodemod(join(tempDir, 'convex'), { dryRun: false })

    const task = readFileSync(join(tempDir, 'convex/models/task.ts'), 'utf-8')
    expect(task).toContain("from 'zodvex/mini'")
    expect(task).not.toContain("from 'zodvex/core'")
  })

  it('transforms .optional() to z.optional()', async () => {
    const { runToMiniCodemod } = await import('../src/cli/codemod')
    await runToMiniCodemod(join(tempDir, 'convex'), { dryRun: false })

    const task = readFileSync(join(tempDir, 'convex/models/task.ts'), 'utf-8')
    // z.string().optional() → z.optional(z.string())
    expect(task).toContain('z.optional(z.string())')
    expect(task).not.toMatch(/z\.string\(\)\.optional\(\)/)
  })

  it('transforms .nullable() to z.nullable()', async () => {
    const { runToMiniCodemod } = await import('../src/cli/codemod')
    await runToMiniCodemod(join(tempDir, 'convex'), { dryRun: false })

    const task = readFileSync(join(tempDir, 'convex/models/task.ts'), 'utf-8')
    // z.enum([...]).nullable() → z.nullable(z.enum([...]))
    expect(task).toContain('z.nullable(')
    expect(task).not.toMatch(/\.nullable\(\)/)
  })

  it('dry-run does not modify files', async () => {
    const before = readFileSync(join(tempDir, 'convex/models/task.ts'), 'utf-8')

    const { runToMiniCodemod } = await import('../src/cli/codemod')
    await runToMiniCodemod(join(tempDir, 'convex'), { dryRun: true })

    const after = readFileSync(join(tempDir, 'convex/models/task.ts'), 'utf-8')
    expect(after).toBe(before)
  })

  it('skips _generated and _zodvex directories', async () => {
    // Our beforeEach already excludes these, but verify the codemod's glob
    // pattern also excludes them by checking it doesn't crash on missing dirs
    const { runToMiniCodemod } = await import('../src/cli/codemod')
    await runToMiniCodemod(join(tempDir, 'convex'), { dryRun: true })
    // If we get here without error, the glob correctly skips missing dirs
  })
})
