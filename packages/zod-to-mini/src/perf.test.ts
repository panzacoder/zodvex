import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { transformCode } from './transforms'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'

const TASK_MANAGER_DIR = resolve(__dirname, '../../../examples/task-manager')
const ZODVEX_TESTS_DIR = resolve(__dirname, '../../../packages/zodvex/__tests__')

function collectTsFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (entry === 'node_modules' || entry === '_generated' || entry === '_zodvex') continue
    if (statSync(full).isDirectory()) {
      files.push(...collectTsFiles(full))
    } else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) {
      files.push(full)
    }
  }
  return files
}

describe('transform performance', () => {
  it('benchmarks task-manager without type checker', () => {
    const files = collectTsFiles(join(TASK_MANAGER_DIR, 'convex'))
    expect(files.length).toBeGreaterThan(0)

    const start = performance.now()
    let changed = 0
    for (const file of files) {
      const code = readFileSync(file, 'utf-8')
      const result = transformCode(code, { filename: file })
      if (result.changed) changed++
    }
    const elapsed = performance.now() - start

    console.log(`[perf] task-manager (no types): ${files.length} files, ${changed} changed, ${elapsed.toFixed(0)}ms (${(elapsed / files.length).toFixed(1)}ms/file)`)
  })

  it('benchmarks task-manager WITH type checker', () => {
    const tsconfig = join(TASK_MANAGER_DIR, 'tsconfig.json')
    let project: Project
    try {
      project = new Project({
        tsConfigFilePath: tsconfig,
        skipAddingFilesFromTsConfig: true,
      })
    } catch {
      console.log('[perf] task-manager has no tsconfig.json, skipping typed benchmark')
      return
    }

    const files = collectTsFiles(join(TASK_MANAGER_DIR, 'convex'))

    const start = performance.now()
    let changed = 0
    for (const file of files) {
      const code = readFileSync(file, 'utf-8')
      const result = transformCode(code, { filename: file, project })
      if (result.changed) changed++
    }
    const elapsed = performance.now() - start

    console.log(`[perf] task-manager (with types): ${files.length} files, ${changed} changed, ${elapsed.toFixed(0)}ms (${(elapsed / files.length).toFixed(1)}ms/file)`)
  })

  it('benchmarks zodvex test suite without type checker', () => {
    const files = collectTsFiles(ZODVEX_TESTS_DIR)

    const start = performance.now()
    let changed = 0
    for (const file of files) {
      const code = readFileSync(file, 'utf-8')
      const result = transformCode(code, { filename: file })
      if (result.changed) changed++
    }
    const elapsed = performance.now() - start

    console.log(`[perf] zodvex tests (no types): ${files.length} files, ${changed} changed, ${elapsed.toFixed(0)}ms (${(elapsed / files.length).toFixed(1)}ms/file)`)
  })

  it('benchmarks zodvex test suite WITH type checker', () => {
    const tsconfig = resolve(__dirname, '../../../packages/zodvex/tsconfig.json')
    const project = new Project({
      tsConfigFilePath: tsconfig,
      skipAddingFilesFromTsConfig: true,
    })

    const files = collectTsFiles(ZODVEX_TESTS_DIR)

    const start = performance.now()
    let changed = 0
    for (const file of files) {
      const code = readFileSync(file, 'utf-8')
      const result = transformCode(code, { filename: file, project })
      if (result.changed) changed++
    }
    const elapsed = performance.now() - start

    console.log(`[perf] zodvex tests (with types): ${files.length} files, ${changed} changed, ${elapsed.toFixed(0)}ms (${(elapsed / files.length).toFixed(1)}ms/file)`)
  })
})
