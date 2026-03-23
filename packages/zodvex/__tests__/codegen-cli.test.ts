import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generate } from '../src/cli/commands'

const fixtureDir = path.resolve(__dirname, 'fixtures/codegen-project')
const outputDir = path.resolve(fixtureDir, '_zodvex')

afterEach(() => {
  // Clean up generated files
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true })
  }
})

describe('generate()', () => {
  it('creates _zodvex/*.js and _zodvex/*.d.ts file pairs', async () => {
    await generate(fixtureDir)

    for (const name of ['schema', 'api', 'client', 'server']) {
      expect(fs.existsSync(path.join(outputDir, `${name}.js`))).toBe(true)
      expect(fs.existsSync(path.join(outputDir, `${name}.d.ts`))).toBe(true)
    }
  })

  it('generated schema.js contains model re-exports', async () => {
    await generate(fixtureDir)

    const content = fs.readFileSync(path.join(outputDir, 'schema.js'), 'utf-8')
    expect(content).toContain('UserModel')
    expect(content).toContain('AUTO-GENERATED')
  })

  it('generated api.js contains function registry', async () => {
    await generate(fixtureDir)

    const content = fs.readFileSync(path.join(outputDir, 'api.js'), 'utf-8')
    expect(content).toContain('zodvexRegistry')
    expect(content).toContain('users:get')
    expect(content).toContain('users:list')
  })

  it('generated client.js contains pre-bound hooks and client factory', async () => {
    await generate(fixtureDir)

    const content = fs.readFileSync(path.join(outputDir, 'client.js'), 'utf-8')
    expect(content).toContain('AUTO-GENERATED')
    expect(content).toContain("import { createZodvexHooks } from 'zodvex/react'")
    expect(content).toContain("import { createZodvexClient } from 'zodvex/client'")
    expect(content).toContain("import { zodvexRegistry } from './api.js'")
    expect(content).toContain('useZodQuery')
    expect(content).toContain('useZodMutation')
    expect(content).toContain('createClient')
  })

  it('generated server.d.ts contains concrete context types', async () => {
    await generate(fixtureDir)

    const content = fs.readFileSync(path.join(outputDir, 'server.d.ts'), 'utf-8')
    expect(content).toContain('AUTO-GENERATED')
    expect(content).toContain('export type QueryCtx')
    expect(content).toContain('export type MutationCtx')
    expect(content).toContain('export type ActionCtx')
  })

  it('throws for non-existent convex directory', async () => {
    expect(generate('/nonexistent/path')).rejects.toThrow()
  })
})
