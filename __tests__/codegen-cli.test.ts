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
  it('creates _zodvex/schema.ts and _zodvex/validators.ts', async () => {
    await generate(fixtureDir)

    expect(fs.existsSync(path.join(outputDir, 'schema.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outputDir, 'validators.ts'))).toBe(true)
  })

  it('generated schema.ts contains model re-exports', async () => {
    await generate(fixtureDir)

    const content = fs.readFileSync(path.join(outputDir, 'schema.ts'), 'utf-8')
    expect(content).toContain('UserModel')
    expect(content).toContain('AUTO-GENERATED')
  })

  it('generated validators.ts contains function registry', async () => {
    await generate(fixtureDir)

    const content = fs.readFileSync(path.join(outputDir, 'validators.ts'), 'utf-8')
    expect(content).toContain('zodvexRegistry')
    expect(content).toContain('users:get')
    expect(content).toContain('users:list')
  })

  it('throws for non-existent convex directory', async () => {
    expect(generate('/nonexistent/path')).rejects.toThrow()
  })
})
