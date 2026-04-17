import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { discoverEntryFiles, moduleNameFromPath, functionPath } from '../src/discovery'

function setupFixtureDir(): string {
  const dir = path.join(
    tmpdir(),
    `convex-graph-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(dir, { recursive: true })
  mkdirSync(path.join(dir, '_generated'), { recursive: true })
  mkdirSync(path.join(dir, '_deps'), { recursive: true })
  mkdirSync(path.join(dir, 'api'), { recursive: true })
  mkdirSync(path.join(dir, 'component'), { recursive: true })
  return dir
}

function writeFile(dir: string, relPath: string, content = 'export const noop = 0'): void {
  const full = path.join(dir, relPath)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf8')
}

describe('discoverEntryFiles', () => {
  it('discovers basic .ts files', () => {
    const dir = setupFixtureDir()
    try {
      writeFile(dir, 'tasks.ts')
      writeFile(dir, 'users.ts')
      const files = discoverEntryFiles(dir)
      expect(files).toContain('tasks.ts')
      expect(files).toContain('users.ts')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('discovers files in subdirectories', () => {
    const dir = setupFixtureDir()
    try {
      writeFile(dir, 'api/reports.ts')
      writeFile(dir, 'models/task.ts')
      const files = discoverEntryFiles(dir)
      expect(files).toContain('api/reports.ts')
      expect(files).toContain('models/task.ts')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('excludes _generated/ files', () => {
    const dir = setupFixtureDir()
    try {
      writeFile(dir, 'tasks.ts')
      writeFile(dir, '_generated/api.ts')
      writeFile(dir, '_generated/server.ts')
      const files = discoverEntryFiles(dir)
      expect(files).toContain('tasks.ts')
      expect(files).not.toContain('_generated/api.ts')
      expect(files).not.toContain('_generated/server.ts')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('excludes _deps/ files', () => {
    const dir = setupFixtureDir()
    try {
      writeFile(dir, '_deps/dep1.js')
      const files = discoverEntryFiles(dir)
      expect(files).not.toContain('_deps/dep1.js')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('excludes schema.ts', () => {
    const dir = setupFixtureDir()
    try {
      writeFile(dir, 'schema.ts')
      writeFile(dir, 'tasks.ts')
      const files = discoverEntryFiles(dir)
      expect(files).not.toContain('schema.ts')
      expect(files).toContain('tasks.ts')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('excludes files with multiple dots', () => {
    const dir = setupFixtureDir()
    try {
      writeFile(dir, 'tasks.ts')
      writeFile(dir, 'tasks.test.ts')
      writeFile(dir, 'tasks.spec.ts')
      const files = discoverEntryFiles(dir)
      expect(files).toContain('tasks.ts')
      expect(files).not.toContain('tasks.test.ts')
      expect(files).not.toContain('tasks.spec.ts')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('excludes dotfiles and # tempfiles', () => {
    const dir = setupFixtureDir()
    try {
      writeFile(dir, '.hidden.ts')
      writeFile(dir, '#temp.ts')
      writeFile(dir, 'tasks.ts')
      const files = discoverEntryFiles(dir)
      expect(files).toContain('tasks.ts')
      expect(files).not.toContain('.hidden.ts')
      expect(files).not.toContain('#temp.ts')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('excludes component-boundary subdirectories', () => {
    const dir = setupFixtureDir()
    try {
      writeFile(dir, 'tasks.ts')
      writeFile(dir, 'component/convex.config.ts')
      writeFile(dir, 'component/inner.ts')
      const files = discoverEntryFiles(dir)
      expect(files).toContain('tasks.ts')
      expect(files).not.toContain('component/inner.ts')
      expect(files).not.toContain('component/convex.config.ts')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('moduleNameFromPath', () => {
  it('strips .ts extension', () => {
    expect(moduleNameFromPath('tasks.ts')).toBe('tasks')
    expect(moduleNameFromPath('api/reports.ts')).toBe('api/reports')
  })

  it('handles .js, .mjs, .cjs, .tsx, .jsx', () => {
    expect(moduleNameFromPath('tasks.js')).toBe('tasks')
    expect(moduleNameFromPath('tasks.mjs')).toBe('tasks')
    expect(moduleNameFromPath('tasks.cjs')).toBe('tasks')
    expect(moduleNameFromPath('tasks.tsx')).toBe('tasks')
    expect(moduleNameFromPath('tasks.jsx')).toBe('tasks')
  })

  it('normalizes backslashes to forward slashes', () => {
    expect(moduleNameFromPath('api\\reports.ts')).toBe('api/reports')
  })
})

describe('functionPath', () => {
  it('joins module name and export name with a colon', () => {
    expect(functionPath('tasks', 'list')).toBe('tasks:list')
    expect(functionPath('api/reports', 'summary')).toBe('api/reports:summary')
    expect(functionPath('tasks', 'default')).toBe('tasks:default')
  })
})
