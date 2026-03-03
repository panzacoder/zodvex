import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { migrate } from '../src/cli/migrate'

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zodvex-migrate-'))
}

function writeFile(dir: string, name: string, content: string) {
  const filePath = path.join(dir, name)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
  return filePath
}

function readFile(filePath: string) {
  return fs.readFileSync(filePath, 'utf-8')
}

describe('migrate', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('identifier renames', () => {
    it('renames CodecDatabaseReader to ZodvexDatabaseReader', () => {
      writeFile(
        tmpDir,
        'convex/functions.ts',
        `import { CodecDatabaseReader } from 'zodvex'
const reader: CodecDatabaseReader = ctx.db
`
      )
      const result = migrate(tmpDir, { dryRun: false })
      const content = readFile(path.join(tmpDir, 'convex/functions.ts'))
      expect(content).toContain('ZodvexDatabaseReader')
      expect(content).not.toContain('CodecDatabaseReader')
      expect(result.filesChanged).toBe(1)
    })

    it('renames CodecDatabaseWriter to ZodvexDatabaseWriter', () => {
      writeFile(
        tmpDir,
        'convex/mutations.ts',
        `import { CodecDatabaseWriter } from 'zodvex'
const writer: CodecDatabaseWriter = ctx.db
`
      )
      migrate(tmpDir, { dryRun: false })
      const content = readFile(path.join(tmpDir, 'convex/mutations.ts'))
      expect(content).toContain('ZodvexDatabaseWriter')
      expect(content).not.toContain('CodecDatabaseWriter')
    })

    it('renames CodecQueryChain to ZodvexQueryChain', () => {
      writeFile(
        tmpDir,
        'convex/queries.ts',
        `import { CodecQueryChain } from 'zodvex'
const chain: CodecQueryChain = db.query('users')
`
      )
      migrate(tmpDir, { dryRun: false })
      const content = readFile(path.join(tmpDir, 'convex/queries.ts'))
      expect(content).toContain('ZodvexQueryChain')
      expect(content).not.toContain('CodecQueryChain')
    })

    it('renames CodecRulesConfig to ZodvexRulesConfig', () => {
      writeFile(
        tmpDir,
        'convex/rules.ts',
        `import { CodecRulesConfig } from 'zodvex'
const config: CodecRulesConfig = {}
`
      )
      migrate(tmpDir, { dryRun: false })
      const content = readFile(path.join(tmpDir, 'convex/rules.ts'))
      expect(content).toContain('ZodvexRulesConfig')
      expect(content).not.toContain('CodecRulesConfig')
    })

    it('renames CodecRules to ZodvexRules (after CodecRulesConfig)', () => {
      writeFile(
        tmpDir,
        'convex/rules.ts',
        `import { CodecRules, CodecRulesConfig } from 'zodvex'
const rules: CodecRules = {}
const config: CodecRulesConfig = {}
`
      )
      migrate(tmpDir, { dryRun: false })
      const content = readFile(path.join(tmpDir, 'convex/rules.ts'))
      expect(content).toContain('ZodvexRules')
      expect(content).toContain('ZodvexRulesConfig')
      expect(content).not.toContain('CodecRules')
      // Ensure CodecRulesConfig was renamed to ZodvexRulesConfig, not ZodvexRulesConfig
      // (i.e., the Config suffix wasn't eaten by an earlier CodecRules → ZodvexRules replace)
      expect(content).toMatch(/ZodvexRulesConfig/)
    })

    it('renames createCodecCustomization to createZodvexCustomization', () => {
      writeFile(
        tmpDir,
        'convex/setup.ts',
        `import { createCodecCustomization } from 'zodvex'
const codec = createCodecCustomization(schema)
`
      )
      migrate(tmpDir, { dryRun: false })
      const content = readFile(path.join(tmpDir, 'convex/setup.ts'))
      expect(content).toContain('createZodvexCustomization')
      expect(content).not.toContain('createCodecCustomization')
    })

    it('renames createCodecHelpers to createBoundaryHelpers', () => {
      writeFile(
        tmpDir,
        'src/client.ts',
        `import { createCodecHelpers } from 'zodvex'
const helpers = createCodecHelpers(registry)
`
      )
      migrate(tmpDir, { dryRun: false })
      const content = readFile(path.join(tmpDir, 'src/client.ts'))
      expect(content).toContain('createBoundaryHelpers')
      expect(content).not.toContain('createCodecHelpers')
    })

    it('renames CodecHelpersOptions to BoundaryHelpersOptions', () => {
      writeFile(
        tmpDir,
        'src/types.ts',
        `import type { CodecHelpersOptions } from 'zodvex'
const opts: CodecHelpersOptions = { onDecodeError: 'throw' }
`
      )
      migrate(tmpDir, { dryRun: false })
      const content = readFile(path.join(tmpDir, 'src/types.ts'))
      expect(content).toContain('BoundaryHelpersOptions')
      expect(content).not.toContain('CodecHelpersOptions')
    })

    it('renames all 8 identifiers in a single file', () => {
      writeFile(
        tmpDir,
        'convex/everything.ts',
        `import {
  CodecDatabaseReader,
  CodecDatabaseWriter,
  CodecQueryChain,
  CodecRulesConfig,
  CodecRules,
  createCodecCustomization,
  createCodecHelpers,
  CodecHelpersOptions,
} from 'zodvex'

type MyReader = CodecDatabaseReader
type MyWriter = CodecDatabaseWriter
type MyChain = CodecQueryChain
type MyConfig = CodecRulesConfig
type MyRules = CodecRules
const custom = createCodecCustomization(schema)
const helpers = createCodecHelpers(registry)
const opts: CodecHelpersOptions = {}
`
      )
      migrate(tmpDir, { dryRun: false })
      const content = readFile(path.join(tmpDir, 'convex/everything.ts'))

      expect(content).toContain('ZodvexDatabaseReader')
      expect(content).toContain('ZodvexDatabaseWriter')
      expect(content).toContain('ZodvexQueryChain')
      expect(content).toContain('ZodvexRulesConfig')
      expect(content).toContain('ZodvexRules')
      expect(content).toContain('createZodvexCustomization')
      expect(content).toContain('createBoundaryHelpers')
      expect(content).toContain('BoundaryHelpersOptions')

      // None of the old names should remain
      expect(content).not.toContain('CodecDatabaseReader')
      expect(content).not.toContain('CodecDatabaseWriter')
      expect(content).not.toContain('CodecQueryChain')
      expect(content).not.toContain('CodecRulesConfig')
      expect(content).not.toContain('CodecRules')
      expect(content).not.toContain('createCodecCustomization')
      expect(content).not.toContain('createCodecHelpers')
      expect(content).not.toContain('CodecHelpersOptions')
    })
  })

  describe('zid() to zx.id() transform', () => {
    it('transforms zid("table") to zx.id("table")', () => {
      writeFile(
        tmpDir,
        'convex/schema.ts',
        `import { zid } from 'zodvex'
const userId = zid('users')
const teamId = zid("teams")
`
      )
      migrate(tmpDir, { dryRun: false })
      const content = readFile(path.join(tmpDir, 'convex/schema.ts'))
      expect(content).toContain("zx.id('users')")
      expect(content).toContain('zx.id("teams")')
      expect(content).not.toMatch(/\bzid\(/)
    })

    it('does not transform zid inside longer identifiers', () => {
      writeFile(
        tmpDir,
        'convex/schema.ts',
        `import { zid } from 'zodvex'
const myzidHelper = 'test'
const userId = zid('users')
`
      )
      migrate(tmpDir, { dryRun: false })
      const content = readFile(path.join(tmpDir, 'convex/schema.ts'))
      expect(content).toContain('myzidHelper')
      expect(content).toContain("zx.id('users')")
    })
  })

  describe('import specifier updates', () => {
    it('removes zid from zodvex import and adds zx', () => {
      writeFile(
        tmpDir,
        'convex/schema.ts',
        `import { zid } from 'zodvex'
const userId = zid('users')
`
      )
      migrate(tmpDir, { dryRun: false })
      const content = readFile(path.join(tmpDir, 'convex/schema.ts'))
      // zid should be removed from the import
      expect(content).not.toMatch(/import\s*\{[^}]*\bzid\b[^}]*\}\s*from\s*['"]zodvex['"]/)
      // zx should be in the import
      expect(content).toMatch(/import\s*\{[^}]*\bzx\b[^}]*\}\s*from\s*['"]zodvex['"]/)
    })

    it('removes zid from multi-specifier import', () => {
      writeFile(
        tmpDir,
        'convex/schema.ts',
        `import { zid, zodTable, z } from 'zodvex'
const userId = zid('users')
`
      )
      migrate(tmpDir, { dryRun: false })
      const content = readFile(path.join(tmpDir, 'convex/schema.ts'))
      expect(content).not.toMatch(/import\s*\{[^}]*\bzid\b[^}]*\}\s*from\s*['"]zodvex['"]/)
      expect(content).toMatch(/\bzx\b/)
    })

    it('does not duplicate zx if already imported', () => {
      writeFile(
        tmpDir,
        'convex/schema.ts',
        `import { zid, zx } from 'zodvex'
const userId = zid('users')
const date = zx.date()
`
      )
      migrate(tmpDir, { dryRun: false })
      const content = readFile(path.join(tmpDir, 'convex/schema.ts'))
      // Should not have zx duplicated in the import specifiers
      expect(content).not.toMatch(
        /import\s*\{[^}]*\bzx\b[^}]*\bzx\b[^}]*\}\s*from\s*['"]zodvex['"]/
      )
    })

    it('handles zodvex/core import path', () => {
      writeFile(
        tmpDir,
        'src/client.ts',
        `import { zid } from 'zodvex/core'
const userId = zid('users')
`
      )
      migrate(tmpDir, { dryRun: false })
      const content = readFile(path.join(tmpDir, 'src/client.ts'))
      expect(content).not.toMatch(/import\s*\{[^}]*\bzid\b[^}]*\}\s*from\s*['"]zodvex\/core['"]/)
      expect(content).toMatch(/\bzx\b/)
    })
  })

  describe('dry-run mode', () => {
    it('reports changes without modifying files', () => {
      const filePath = writeFile(
        tmpDir,
        'convex/functions.ts',
        `import { CodecDatabaseReader, zid } from 'zodvex'
const reader: CodecDatabaseReader = ctx.db
const userId = zid('users')
`
      )
      const original = readFile(filePath)
      const result = migrate(tmpDir, { dryRun: true })

      // File should not be modified
      expect(readFile(filePath)).toBe(original)
      // But result should report it would change
      expect(result.wouldChange).toBe(1)
      expect(result.filesChanged).toBe(0)
    })

    it('counts multiple files that would change', () => {
      writeFile(
        tmpDir,
        'convex/a.ts',
        `import { CodecDatabaseReader } from 'zodvex'
`
      )
      writeFile(
        tmpDir,
        'convex/b.ts',
        `import { CodecDatabaseWriter } from 'zodvex'
`
      )
      const result = migrate(tmpDir, { dryRun: true })
      expect(result.wouldChange).toBe(2)
      expect(result.filesChanged).toBe(0)
    })
  })

  describe('directory skipping', () => {
    it('skips node_modules/', () => {
      writeFile(
        tmpDir,
        'node_modules/some-pkg/index.ts',
        `import { CodecDatabaseReader } from 'zodvex'
`
      )
      const result = migrate(tmpDir, { dryRun: false })
      const content = readFile(path.join(tmpDir, 'node_modules/some-pkg/index.ts'))
      expect(content).toContain('CodecDatabaseReader')
      expect(result.filesChanged).toBe(0)
    })

    it('skips .git/', () => {
      writeFile(
        tmpDir,
        '.git/hooks/pre-commit.ts',
        `import { CodecDatabaseReader } from 'zodvex'
`
      )
      const result = migrate(tmpDir, { dryRun: false })
      expect(result.filesScanned).toBe(0)
    })

    it('skips _generated/', () => {
      writeFile(
        tmpDir,
        'convex/_generated/api.ts',
        `import { CodecDatabaseReader } from 'zodvex'
`
      )
      const result = migrate(tmpDir, { dryRun: false })
      expect(result.filesScanned).toBe(0)
    })

    it('skips _zodvex/', () => {
      writeFile(
        tmpDir,
        'convex/_zodvex/api.ts',
        `import { CodecDatabaseReader } from 'zodvex'
`
      )
      const result = migrate(tmpDir, { dryRun: false })
      expect(result.filesScanned).toBe(0)
    })

    it('skips dist/', () => {
      writeFile(
        tmpDir,
        'dist/index.ts',
        `import { CodecDatabaseReader } from 'zodvex'
`
      )
      const result = migrate(tmpDir, { dryRun: false })
      expect(result.filesScanned).toBe(0)
    })

    it('skips non-TS files', () => {
      writeFile(tmpDir, 'README.md', 'Uses CodecDatabaseReader for something')
      writeFile(tmpDir, 'config.json', '{"name": "CodecDatabaseReader"}')
      const result = migrate(tmpDir, { dryRun: false })
      expect(result.filesScanned).toBe(0)
    })

    it('processes .tsx files', () => {
      writeFile(
        tmpDir,
        'src/App.tsx',
        `import { CodecDatabaseReader } from 'zodvex'
`
      )
      migrate(tmpDir, { dryRun: false })
      const content = readFile(path.join(tmpDir, 'src/App.tsx'))
      expect(content).toContain('ZodvexDatabaseReader')
    })
  })

  describe('remaining deprecation warnings', () => {
    it('reports zodTable usage', () => {
      writeFile(
        tmpDir,
        'convex/schema.ts',
        `import { zodTable } from 'zodvex'
const users = zodTable({ name: z.string() })
`
      )
      const result = migrate(tmpDir, { dryRun: false })
      expect(result.remainingDeprecations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ symbol: 'zodTable', line: expect.any(Number) })
        ])
      )
    })

    it('reports multiple deprecated symbols', () => {
      writeFile(
        tmpDir,
        'convex/functions.ts',
        `import { zQueryBuilder, zMutationBuilder, convexCodec } from 'zodvex'
const q = zQueryBuilder(query)
const m = zMutationBuilder(mutation)
const c = convexCodec(z.number(), z.date(), { decode: d => d, encode: e => e })
`
      )
      const result = migrate(tmpDir, { dryRun: false })
      const symbols = result.remainingDeprecations.map(d => d.symbol)
      expect(symbols).toContain('zQueryBuilder')
      expect(symbols).toContain('zMutationBuilder')
      expect(symbols).toContain('convexCodec')
    })

    it('reports all deprecated builder symbols', () => {
      writeFile(
        tmpDir,
        'convex/functions.ts',
        `import { zActionBuilder, zCustomQueryBuilder, zCustomMutationBuilder, zCustomActionBuilder } from 'zodvex'
const a = zActionBuilder(action)
const cq = zCustomQueryBuilder(query)
const cm = zCustomMutationBuilder(mutation)
const ca = zCustomActionBuilder(action)
`
      )
      const result = migrate(tmpDir, { dryRun: false })
      const symbols = result.remainingDeprecations.map(d => d.symbol)
      expect(symbols).toContain('zActionBuilder')
      expect(symbols).toContain('zCustomQueryBuilder')
      expect(symbols).toContain('zCustomMutationBuilder')
      expect(symbols).toContain('zCustomActionBuilder')
    })

    it('reports zodDoc and zodDocOrNull', () => {
      writeFile(
        tmpDir,
        'convex/schema.ts',
        `import { zodDoc, zodDocOrNull } from 'zodvex'
const doc = zodDoc(userSchema)
const maybeDoc = zodDocOrNull(userSchema)
`
      )
      const result = migrate(tmpDir, { dryRun: false })
      const symbols = result.remainingDeprecations.map(d => d.symbol)
      expect(symbols).toContain('zodDoc')
      expect(symbols).toContain('zodDocOrNull')
    })

    it('reports mapDateFieldToNumber', () => {
      writeFile(
        tmpDir,
        'convex/utils.ts',
        `import { mapDateFieldToNumber } from 'zodvex'
const mapped = mapDateFieldToNumber(schema, 'createdAt')
`
      )
      const result = migrate(tmpDir, { dryRun: false })
      const symbols = result.remainingDeprecations.map(d => d.symbol)
      expect(symbols).toContain('mapDateFieldToNumber')
    })

    it('includes file path and line number in warnings', () => {
      const filePath = writeFile(
        tmpDir,
        'convex/schema.ts',
        `import { zodTable } from 'zodvex'
// some comment
const users = zodTable({ name: z.string() })
`
      )
      const result = migrate(tmpDir, { dryRun: false })
      const warning = result.remainingDeprecations.find(
        d => d.symbol === 'zodTable' && d.line === 3
      )
      expect(warning).toBeDefined()
      expect(warning?.file).toBe(filePath)
    })
  })

  describe('edge cases', () => {
    it('handles files with no zodvex imports (no-op)', () => {
      writeFile(
        tmpDir,
        'src/utils.ts',
        `const x = 1
export function hello() { return 'world' }
`
      )
      const result = migrate(tmpDir, { dryRun: false })
      expect(result.filesScanned).toBe(1)
      expect(result.filesChanged).toBe(0)
    })

    it('preserves Zid type (no rename needed)', () => {
      writeFile(
        tmpDir,
        'convex/types.ts',
        `import type { Zid } from 'zodvex'
type UserId = Zid<'users'>
`
      )
      migrate(tmpDir, { dryRun: false })
      const content = readFile(path.join(tmpDir, 'convex/types.ts'))
      // Zid should remain unchanged
      expect(content).toContain('Zid')
      expect(content).toMatch(/\bZid\b/)
    })

    it('returns correct filesScanned count', () => {
      writeFile(tmpDir, 'a.ts', 'const a = 1')
      writeFile(tmpDir, 'b.ts', 'const b = 2')
      writeFile(tmpDir, 'c.tsx', 'const c = 3')
      writeFile(tmpDir, 'd.js', 'const d = 4') // should be skipped
      const result = migrate(tmpDir, { dryRun: false })
      expect(result.filesScanned).toBe(3)
    })

    it('handles empty directory', () => {
      const result = migrate(tmpDir, { dryRun: false })
      expect(result.filesScanned).toBe(0)
      expect(result.filesChanged).toBe(0)
      expect(result.wouldChange).toBe(0)
      expect(result.remainingDeprecations).toEqual([])
    })
  })
})
