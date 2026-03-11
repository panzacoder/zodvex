import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateStubs, gitignoreEntry } from '../src/cli/init'

describe('generateStubs', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zodvex-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates _zodvex directory', () => {
    generateStubs(tmpDir)
    expect(fs.existsSync(path.join(tmpDir, '_zodvex'))).toBe(true)
  })

  it('creates api.ts stub with empty registry', () => {
    generateStubs(tmpDir)
    const content = fs.readFileSync(path.join(tmpDir, '_zodvex', 'api.ts'), 'utf-8')
    expect(content).toContain('zodvexRegistry')
    expect(content).toContain('as const')
    expect(content).toContain('Auto-generated stub')
  })

  it('creates client.ts stub', () => {
    generateStubs(tmpDir)
    const content = fs.readFileSync(path.join(tmpDir, '_zodvex', 'client.ts'), 'utf-8')
    expect(content).toContain('useZodQuery')
    expect(content).toContain('useZodMutation')
    expect(content).toContain('createClient')
  })

  it('client.ts imports from api stub', () => {
    generateStubs(tmpDir)
    const content = fs.readFileSync(path.join(tmpDir, '_zodvex', 'client.ts'), 'utf-8')
    expect(content).toContain("import { zodvexRegistry } from './api'")
  })

  it('is idempotent (can run twice without error)', () => {
    generateStubs(tmpDir)
    generateStubs(tmpDir) // should not throw
    expect(fs.existsSync(path.join(tmpDir, '_zodvex', 'api.ts'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, '_zodvex', 'client.ts'))).toBe(true)
  })
})

describe('gitignoreEntry', () => {
  it('adds convex/_zodvex/ entry to empty content', () => {
    const result = gitignoreEntry('')
    expect(result).toContain('convex/_zodvex/')
  })

  it('returns null if entry already exists', () => {
    const result = gitignoreEntry('convex/_zodvex/')
    expect(result).toBeNull()
  })

  it('preserves existing content', () => {
    const result = gitignoreEntry('node_modules/\n.env')
    expect(result).toContain('node_modules/')
    expect(result).toContain('.env')
    expect(result).toContain('convex/_zodvex/')
  })
})
