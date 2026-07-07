import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadTsconfigAliases,
  matchAlias,
  stripJsonComments
} from '../src/public/codegen/tsconfigPaths'

const tmpDirs: string[] = []

function makeProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zodvex-tsconfig-'))
  tmpDirs.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
  return dir
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('stripJsonComments', () => {
  it('removes line and block comments and trailing commas', () => {
    const input = `{
      // line comment
      "a": 1, /* block */
      "b": "http://not-a-comment", // trailing
      "c": [1, 2,],
    }`
    expect(JSON.parse(stripJsonComments(input))).toEqual({
      a: 1,
      b: 'http://not-a-comment',
      c: [1, 2]
    })
  })

  it('preserves comment-like sequences inside strings', () => {
    const input = '{"url": "a//b", "glob": "x/*y*/z"}'
    expect(JSON.parse(stripJsonComments(input))).toEqual({ url: 'a//b', glob: 'x/*y*/z' })
  })
})

describe('loadTsconfigAliases + matchAlias', () => {
  it('resolves a root-level @/* alias for a nested convex dir (the hotpot shape)', () => {
    const root = makeProject({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@/*': ['./*'] } }
      }),
      'convex/placeholder.ts': ''
    })

    const aliases = loadTsconfigAliases(path.join(root, 'convex'))
    expect(aliases).toHaveLength(1)

    const candidates = matchAlias('@/convex/lib/scopes', aliases)
    expect(candidates).toEqual([path.join(root, 'convex/lib/scopes')])
  })

  it('follows a relative extends chain to find paths', () => {
    const root = makeProject({
      'tsconfig.base.json': JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '~/*': ['./src/*'] } }
      }),
      'app/tsconfig.json': JSON.stringify({ extends: '../tsconfig.base.json' }),
      'app/convex/placeholder.ts': ''
    })

    const aliases = loadTsconfigAliases(path.join(root, 'app/convex'))
    const candidates = matchAlias('~/util', aliases)
    // paths declared in the base config resolve relative to ITS baseUrl.
    expect(candidates).toEqual([path.join(root, 'src/util')])
  })

  it('supports exact (non-wildcard) patterns and multiple targets', () => {
    const root = makeProject({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          paths: { config: ['./src/config.ts'], 'lib/*': ['./a/*', './b/*'] }
        }
      })
    })

    const aliases = loadTsconfigAliases(root)
    expect(matchAlias('config', aliases)).toEqual([path.join(root, 'src/config.ts')])
    expect(matchAlias('lib/x', aliases)).toEqual([path.join(root, 'a/x'), path.join(root, 'b/x')])
    expect(matchAlias('other', aliases)).toEqual([])
  })

  it('nearest tsconfig wins for duplicate patterns', () => {
    const root = makeProject({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { paths: { '@/*': ['./outer/*'] } }
      }),
      'convex/tsconfig.json': JSON.stringify({
        compilerOptions: { paths: { '@/*': ['./inner/*'] } }
      })
    })

    const aliases = loadTsconfigAliases(path.join(root, 'convex'))
    expect(matchAlias('@/x', aliases)).toEqual([path.join(root, 'convex/inner/x')])
  })

  it('tolerates JSONC syntax and missing/invalid configs', () => {
    const root = makeProject({
      'tsconfig.json': `{
        // JSONC is the norm for tsconfig
        "compilerOptions": {
          "paths": { "@/*": ["./*"], },
        },
      }`
    })
    expect(matchAlias('@/y', loadTsconfigAliases(root))).toEqual([path.join(root, 'y')])

    const empty = makeProject({ 'not-a-tsconfig.txt': '' })
    expect(loadTsconfigAliases(empty)).toEqual([])
  })
})
