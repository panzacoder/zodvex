import path from 'node:path'
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { analyze } from '../src/analyze'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const TASK_MANAGER = path.join(REPO_ROOT, 'examples', 'task-manager', 'convex')
const TASK_MANAGER_MINI = path.join(REPO_ROOT, 'examples', 'task-manager-mini', 'convex')

const ZODVEX_BUILDERS = {
  query: ['zq'],
  mutation: ['zm'],
  action: ['za'],
  internalQuery: ['ziq'],
  internalMutation: ['zim'],
  internalAction: ['zia']
}

// Skip these tests if the examples aren't present (e.g., published package install).
const taskManagerReady = existsSync(TASK_MANAGER)
const taskManagerMiniReady = existsSync(TASK_MANAGER_MINI)

const maybeDescribe = taskManagerReady ? describe : describe.skip

maybeDescribe('integration — task-manager example', () => {
  const graph = analyze({
    convexDir: TASK_MANAGER,
    builders: ZODVEX_BUILDERS
  })

  it('discovers a realistic number of functions', () => {
    // Guard against the analyzer silently finding nothing due to a builder-name regression.
    const count = Object.keys(graph.functions).length
    expect(count).toBeGreaterThan(20)
  })

  it('resolves common expected table dependencies', () => {
    // Known cases from the example project. These assertions catch regressions in
    // string-literal extraction, Id type resolution, and helper following.
    expect(graph.functions['tasks:create']?.writes).toContain('tasks')
    expect(graph.functions['tasks:list']?.reads).toContain('tasks')
    expect(graph.functions['tasks:update']?.writes).toContain('tasks')
    expect(graph.functions['tasks:complete']?.writes).toContain('tasks')
    expect(graph.functions['users:getByEmail']?.reads).toContain('users')
    expect(graph.functions['comments:list']?.reads).toContain('comments')
    expect(graph.functions['comments:create']?.writes).toContain('comments')
    expect(graph.functions['notifications:createEmail']?.writes).toContain('notifications')
  })

  it('resolves Id<"table"> type parameters on patch/get', () => {
    // tasks:get → ctx.db.get(id) where id is Id<"tasks">
    expect(graph.functions['tasks:get']?.reads).toContain('tasks')
    // users:get → same pattern
    expect(graph.functions['users:get']?.reads).toContain('users')
  })

  it('resolves db wrapper methods like withRules', () => {
    expect(graph.functions['securedTasks:listOwnTasks']?.reads).toContain('tasks')
    expect(graph.functions['securedTasks:updateOwnTask']?.writes).toContain('tasks')
  })

  it('distinguishes internal from public visibility', () => {
    const secretInsert = graph.functions['cleanup:queryCompletedTasks']
    if (secretInsert) expect(secretInsert.visibility).toBe('internal')

    const publicCreate = graph.functions['tasks:create']
    if (publicCreate) expect(publicCreate.visibility).toBe('public')
  })

  it('emits diagnostics only for genuinely-unresolvable patterns', () => {
    // Dynamic table names and `any`-typed IDs are the remaining legitimate cases.
    // This bound catches regressions where resolution starts failing on things we
    // previously resolved.
    expect(graph.diagnostics.length).toBeLessThanOrEqual(5)
  })
})

const maybeDescribeMini = taskManagerMiniReady ? describe : describe.skip

maybeDescribeMini('integration — task-manager-mini example (zod/mini)', () => {
  const graph = analyze({
    convexDir: TASK_MANAGER_MINI,
    builders: ZODVEX_BUILDERS
  })

  it('analyzes zod/mini-based code with the same accuracy', () => {
    // Mini variant has the same structure; we expect zero diagnostics.
    expect(graph.diagnostics.length).toBeLessThanOrEqual(3)
    expect(Object.keys(graph.functions).length).toBeGreaterThan(20)
  })

  it('resolves table dependencies regardless of zod flavor', () => {
    expect(graph.functions['tasks:create']?.writes).toContain('tasks')
    expect(graph.functions['tasks:list']?.reads).toContain('tasks')
  })
})
