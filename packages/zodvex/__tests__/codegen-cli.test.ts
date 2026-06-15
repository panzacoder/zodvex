import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generate, generateCheck } from '../src/public/cli/commands'

const fixtureDir = path.resolve(__dirname, 'fixtures/codegen-project')
const outputDir = path.resolve(fixtureDir, '_zodvex')

afterEach(() => {
  // Clean up generated files
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true })
  }
})

describe('generate()', () => {
  it('creates the expected _zodvex/ artifacts', async () => {
    await generate(fixtureDir)

    // .js + .d.ts pairs (no codegen-time type inference needed)
    for (const name of ['schema', 'api', 'client']) {
      expect(fs.existsSync(path.join(outputDir, `${name}.js`))).toBe(true)
      expect(fs.existsSync(path.join(outputDir, `${name}.d.ts`))).toBe(true)
    }
    // Single TS files where literal-type inference flows from runtime
    expect(fs.existsSync(path.join(outputDir, 'tables.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outputDir, 'server.ts'))).toBe(true)
    // Convex-walker skip marker
    expect(fs.existsSync(path.join(outputDir, 'convex.config.ts'))).toBe(true)
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

  it('generated server.ts contains context types + pre-wired initZodvex', async () => {
    await generate(fixtureDir)

    const content = fs.readFileSync(path.join(outputDir, 'server.ts'), 'utf-8')
    expect(content).toContain('AUTO-GENERATED')
    expect(content).toContain('export type QueryCtx')
    expect(content).toContain('export type MutationCtx')
    expect(content).toContain('export type ActionCtx')
    expect(content).toContain('export function initZodvex')
    // Split registry: lazy full (actions) + static args-only (mutations).
    expect(content).toContain("import('./api.js')")
    expect(content).toContain("import { zodvexArgsRegistry as _argsRegistry } from './api.args.js'")

    // The args-only registry file is emitted alongside api.js.
    const argsContent = fs.readFileSync(path.join(outputDir, 'api.args.js'), 'utf-8')
    expect(argsContent).toContain('export const zodvexArgsRegistry')
    expect(argsContent).not.toContain('returns:')
  })

  it('throws for non-existent convex directory', async () => {
    expect(generate('/nonexistent/path')).rejects.toThrow()
  })
})

describe('generateCheck() — staleness guard', () => {
  it('reports up to date immediately after generate', async () => {
    await generate(fixtureDir)
    const stale = await generateCheck(fixtureDir)
    expect(stale).toEqual([])
  })

  it('detects a stale (hand-edited) generated file and is non-destructive', async () => {
    await generate(fixtureDir)
    const target = path.join(outputDir, 'tables.ts')
    const tampered = '// hand-edited — stale\n'
    fs.writeFileSync(target, tampered)

    const stale = await generateCheck(fixtureDir)
    expect(stale).toContain('tables.ts')

    // Non-destructive: check leaves the file exactly as it found it (the
    // tampered content), rather than silently regenerating it.
    expect(fs.readFileSync(target, 'utf-8')).toBe(tampered)
  })

  it('detects a missing generated file and restores it as missing', async () => {
    await generate(fixtureDir)
    const target = path.join(outputDir, 'models', 'index.js')
    expect(fs.existsSync(target)).toBe(true)
    fs.unlinkSync(target)

    const stale = await generateCheck(fixtureDir)
    expect(stale).toContain('models/index.js')
    // Restored to the pre-check state — i.e. still missing.
    expect(fs.existsSync(target)).toBe(false)
  })

  it('leaves an up-to-date tree byte-identical after the check', async () => {
    await generate(fixtureDir)
    const snap = (p: string) => fs.readFileSync(path.join(outputDir, p), 'utf-8')
    const before = { api: snap('api.js'), tables: snap('tables.ts'), idx: snap('models/index.js') }

    const stale = await generateCheck(fixtureDir)
    expect(stale).toEqual([])
    expect(snap('api.js')).toBe(before.api)
    expect(snap('tables.ts')).toBe(before.tables)
    expect(snap('models/index.js')).toBe(before.idx)
  })
})
