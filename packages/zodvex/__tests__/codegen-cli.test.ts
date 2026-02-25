import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
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
  it('creates _zodvex/schema.ts, _zodvex/api.ts, _zodvex/client.ts, and _zodvex/server.ts', async () => {
    await generate(fixtureDir)

    expect(fs.existsSync(path.join(outputDir, 'schema.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outputDir, 'api.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outputDir, 'client.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outputDir, 'server.ts'))).toBe(true)
  })

  it('generated schema.ts contains model re-exports', async () => {
    await generate(fixtureDir)

    const content = fs.readFileSync(path.join(outputDir, 'schema.ts'), 'utf-8')
    expect(content).toContain('UserModel')
    expect(content).toContain('AUTO-GENERATED')
  })

  it('generated api.ts contains function registry', async () => {
    await generate(fixtureDir)

    const content = fs.readFileSync(path.join(outputDir, 'api.ts'), 'utf-8')
    expect(content).toContain('zodvexRegistry')
    expect(content).toContain('users:get')
    expect(content).toContain('users:list')
  })

  it('generated client.ts contains pre-bound hooks and client factory', async () => {
    await generate(fixtureDir)

    const content = fs.readFileSync(path.join(outputDir, 'client.ts'), 'utf-8')
    expect(content).toContain('AUTO-GENERATED')
    expect(content).toContain("import { createZodvexHooks } from 'zodvex/react'")
    expect(content).toContain(
      "import { createZodvexClient, type ZodvexClientOptions } from 'zodvex/client'"
    )
    expect(content).toContain("import { zodvexRegistry } from './api'")
    expect(content).toContain('useZodQuery')
    expect(content).toContain('useZodMutation')
    expect(content).toContain('createClient')
  })

  it('generated server.ts contains concrete context types', async () => {
    await generate(fixtureDir)

    const content = fs.readFileSync(path.join(outputDir, 'server.ts'), 'utf-8')
    expect(content).toContain('AUTO-GENERATED')
    expect(content).toContain('export type QueryCtx')
    expect(content).toContain('export type MutationCtx')
    expect(content).toContain('export type ActionCtx')
  })

  it('throws for non-existent convex directory', async () => {
    expect(generate('/nonexistent/path')).rejects.toThrow()
  })
})
