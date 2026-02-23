import { describe, expect, it } from 'bun:test'
import path from 'node:path'
import { discoverModules } from '../src/codegen/discover'

const fixtureDir = path.resolve(__dirname, 'fixtures/codegen-project')

describe('discoverModules', () => {
  it('discovers models with correct exportName and tableName', async () => {
    const result = await discoverModules(fixtureDir)

    expect(result.models.length).toBe(1)
    const model = result.models[0]
    expect(model.exportName).toBe('UserModel')
    expect(model.tableName).toBe('users')
  })

  it('discovers functions with correct functionPath', async () => {
    const result = await discoverModules(fixtureDir)

    const fnPaths = result.functions.map(f => f.functionPath).sort()
    expect(fnPaths).toContain('users:get')
    expect(fnPaths).toContain('users:list')
    // helper has no metadata, should be excluded
    expect(fnPaths).not.toContain('users:helper')
  })

  it('skips _generated/ and _zodvex/ directories', async () => {
    const result = await discoverModules(fixtureDir)

    const allPaths = [
      ...result.models.map(m => m.sourceFile),
      ...result.functions.map(f => f.sourceFile)
    ]
    for (const p of allPaths) {
      expect(p).not.toContain('_generated')
      expect(p).not.toContain('_zodvex')
    }
  })

  it('records source file path for import generation', async () => {
    const result = await discoverModules(fixtureDir)

    const model = result.models[0]
    expect(model.sourceFile).toContain('models/user.ts')

    const fn = result.functions.find(f => f.functionPath === 'users:get')
    expect(fn).toBeDefined()
    expect(fn!.sourceFile).toContain('users.ts')
  })
})
