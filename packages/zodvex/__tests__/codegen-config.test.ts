import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type ClientIntegration,
  type ZodvexConfig,
  defineConfig,
  isExplicitDependency,
  loadConfig,
  registerBuiltinIntegration,
  resolveIntegrations
} from '../src/codegen/config'
import { generateClientFile } from '../src/codegen/generate'
import { mantineIntegration } from '../src/codegen/integrations/mantine'

describe('defineConfig', () => {
  it('returns the config object unchanged', () => {
    const config: ZodvexConfig = {
      client: { integrations: ['mantine'] }
    }
    expect(defineConfig(config)).toBe(config)
  })

  it('returns empty config unchanged', () => {
    const config: ZodvexConfig = {}
    expect(defineConfig(config)).toBe(config)
  })
})

describe('isExplicitDependency', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zodvex-config-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true })
  })

  it('returns true when package is in dependencies', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { '@mantine/form': '^7.0.0' } })
    )
    expect(isExplicitDependency('@mantine/form', tmpDir)).toBe(true)
  })

  it('returns true when package is in devDependencies', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ devDependencies: { '@mantine/form': '^7.0.0' } })
    )
    expect(isExplicitDependency('@mantine/form', tmpDir)).toBe(true)
  })

  it('returns false when package is not listed', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { react: '^18.0.0' } })
    )
    expect(isExplicitDependency('@mantine/form', tmpDir)).toBe(false)
  })

  it('returns false when package.json does not exist', () => {
    expect(isExplicitDependency('@mantine/form', tmpDir)).toBe(false)
  })

  it('returns false when package.json has no dependencies field', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }))
    expect(isExplicitDependency('@mantine/form', tmpDir)).toBe(false)
  })
})

describe('loadConfig', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zodvex-config-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true })
  })

  it('returns empty config when no config file exists', async () => {
    const config = await loadConfig(tmpDir)
    expect(config).toEqual({})
  })

  it('loads zodvex.config.json', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'zodvex.config.json'),
      JSON.stringify({ client: { integrations: ['mantine'] } })
    )
    const config = await loadConfig(tmpDir)
    expect(config).toEqual({ client: { integrations: ['mantine'] } })
  })

  it('loads zodvex.config.js with default export', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'zodvex.config.js'),
      'export default { client: { integrations: ["mantine"], autoDetect: true } }\n'
    )
    const config = await loadConfig(tmpDir)
    expect(config).toEqual({ client: { integrations: ['mantine'], autoDetect: true } })
  })
})

describe('resolveIntegrations', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zodvex-config-test-'))
    // Register mantine for tests
    registerBuiltinIntegration('mantine', () => mantineIntegration)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true })
  })

  it('returns empty array when no integrations configured', () => {
    const result = resolveIntegrations({}, tmpDir)
    expect(result).toEqual([])
  })

  it('returns mantine integration when explicitly listed', () => {
    const config: ZodvexConfig = { client: { integrations: ['mantine'] } }
    const result = resolveIntegrations(config, tmpDir)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('mantine')
  })

  it('warns and skips unknown integration names', () => {
    const config: ZodvexConfig = { client: { integrations: ['nonexistent'] } }
    const warned: string[] = []
    const origWarn = console.warn
    console.warn = (msg: string) => warned.push(msg)
    try {
      const result = resolveIntegrations(config, tmpDir)
      expect(result).toEqual([])
      expect(warned[0]).toContain('Unknown integration')
      expect(warned[0]).toContain('nonexistent')
    } finally {
      console.warn = origWarn
    }
  })

  it('autoDetect adds integration when peer dependency is in package.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { '@mantine/form': '^7.0.0' } })
    )
    const config: ZodvexConfig = { client: { autoDetect: true } }
    const result = resolveIntegrations(config, tmpDir)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('mantine')
  })

  it('autoDetect does not add integration when peer dependency is missing', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { react: '^18.0.0' } })
    )
    const config: ZodvexConfig = { client: { autoDetect: true } }
    const result = resolveIntegrations(config, tmpDir)
    expect(result).toEqual([])
  })

  it('explicit integrations and autoDetect are deduplicated', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { '@mantine/form': '^7.0.0' } })
    )
    const config: ZodvexConfig = {
      client: { integrations: ['mantine'], autoDetect: true }
    }
    const result = resolveIntegrations(config, tmpDir)
    // Should only appear once (Set-based dedup)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('mantine')
  })
})

describe('mantineIntegration', () => {
  it('has correct name and peerDependency', () => {
    expect(mantineIntegration.name).toBe('mantine')
    expect(mantineIntegration.peerDependency).toBe('@mantine/form')
  })

  it('generates JS imports referencing zodvex/form/mantine', () => {
    const imports = mantineIntegration.generateImports()
    expect(imports).toContain("from 'zodvex/form/mantine'")
    expect(imports).toContain('_mantineResolver')
  })

  it('generates JS exports using zodvexRegistry', () => {
    const exports = mantineIntegration.generateExports()
    expect(exports).toContain('mantineResolver')
    expect(exports).toContain('zodvexRegistry')
  })

  it('generates DTS imports and exports', () => {
    const dtsImports = mantineIntegration.generateDtsImports()
    expect(dtsImports).toContain('FunctionReference')

    const dtsExports = mantineIntegration.generateDtsExports()
    expect(dtsExports).toContain('mantineResolver')
  })
})

describe('generateClientFile with integrations', () => {
  it('includes mantine imports and exports when integration is provided', () => {
    const { js, dts } = generateClientFile([mantineIntegration])

    // JS should have mantine import and export
    expect(js).toContain(
      "import { mantineResolver as _mantineResolver } from 'zodvex/form/mantine'"
    )
    expect(js).toContain('export const mantineResolver')
    expect(js).toContain('_mantineResolver(zodvexRegistry, ref)')

    // DTS should have typed mantine declaration
    expect(dts).toContain("import type { FunctionReference } from 'convex/server'")
    expect(dts).toContain('export declare const mantineResolver')
  })

  it('does not include mantine when no integrations provided', () => {
    const { js, dts } = generateClientFile()
    expect(js).not.toContain('mantineResolver')
    expect(dts).not.toContain('mantineResolver')
  })

  it('does not include mantine when empty array provided', () => {
    const { js, dts } = generateClientFile([])
    expect(js).not.toContain('mantineResolver')
    expect(dts).not.toContain('mantineResolver')
  })

  it('supports multiple integrations', () => {
    const fakeIntegration: ClientIntegration = {
      name: 'fake',
      peerDependency: 'fake-lib',
      generateImports: () => "import { fakeHelper } from 'fake-lib'",
      generateExports: () => 'export const fakeExport = fakeHelper(zodvexRegistry)',
      generateDtsImports: () => "import type { FakeType } from 'fake-lib'",
      generateDtsExports: () => 'export declare const fakeExport: FakeType'
    }

    const { js, dts } = generateClientFile([mantineIntegration, fakeIntegration])

    // Both integrations present in JS
    expect(js).toContain('mantineResolver')
    expect(js).toContain('fakeExport')
    expect(js).toContain("from 'zodvex/form/mantine'")
    expect(js).toContain("from 'fake-lib'")

    // Both integrations present in DTS
    expect(dts).toContain('mantineResolver')
    expect(dts).toContain('fakeExport')
  })

  it('still includes core exports when integrations are added', () => {
    const { js, dts } = generateClientFile([mantineIntegration])

    // Core exports still present
    expect(js).toContain('useZodQuery')
    expect(js).toContain('createClient')
    expect(js).toContain('createReactClient')
    expect(js).toContain('encodeArgs')
    expect(dts).toContain('useZodQuery')
    expect(dts).toContain('createClient')
  })
})
