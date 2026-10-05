import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []
const cli = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url))
const codegen = new URL('../dist/codegen/index.js', import.meta.url).href

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zodvex-runtime-'))
  roots.push(root)
  const convex = path.join(root, 'convex')
  const write = (file: string, content: string) => {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  write(
    'tsconfig.base.json',
    JSON.stringify({
      compilerOptions: {
        paths: {
          '@/*': ['./src/*'],
          choice: ['./src/far.ts'],
          'fallback/*': ['./missing/*', './src/*'],
          'suffix/*/end': ['./src/*']
        }
      }
    })
  )
  write('tsconfig.json', '{"extends":"./tsconfig.base.json"}')
  write(
    'convex/tsconfig.json',
    JSON.stringify({
      extends: '../tsconfig.json',
      compilerOptions: {
        baseUrl: '.',
        paths: {
          choice: ['../src/near.ts'],
          '@/*': ['../src/*'],
          'fallback/*': ['../missing/*', '../src/*'],
          'suffix/*/end': ['../src/*']
        }
      }
    })
  )
  write('src/far.ts', 'export const label = "wrong"')
  write('src/near.ts', 'export const label = "near"')
  write('src/check.ts', 'export const check = "ok"')
  write('convex/_generated/api.ts', 'throw new Error("real generated API must not run")\r\n')
  write('convex/_zodvex/api.js', 'throw new Error("stale registry must not run")\n')
  return { root, convex, write }
}
function moduleSource(name: string, runtime: string) {
  return `
import { label } from 'choice';
import { check } from '@/check';
import { check as fallback } from 'fallback/check';
// Bun's native resolver does not support the loader's wildcard suffix case.
import { check as suffix } from '${runtime === 'node' ? 'suffix/check/end' : '@/check'}';
import { components } from './_generated/api';
import { zodvexRegistry } from './_zodvex/api.js';
if (label !== 'near' || check !== 'ok' || fallback !== 'ok' || suffix !== 'ok') throw new Error('alias mismatch');
const ref = new components.demo.Component(components.demo);
ref.deep().next();
export const ${name} = () => ref;
Object.defineProperty(${name}, '__zodvexMeta', { value: { type: 'function' } });
`
}
function run(runtime: string, args: string[], cwd?: string) {
  return spawnSync(runtime, args, { encoding: 'utf8', timeout: 30000, cwd })
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe.each(['node', 'bun'])('discovery environment under %s', runtime => {
  it('resolves production aliases and Proxy behavior and regenerates with fresh source', () => {
    const { root, convex, write } = project()
    write('convex/jobs.ts', moduleSource('alpha', runtime))
    const original = fs.readFileSync(path.join(convex, '_generated/api.ts'))
    let result = run(runtime, [cli, 'generate', convex], root)
    expect(result.status, result.stderr).toBe(0)
    expect(fs.readFileSync(path.join(convex, '_zodvex/api.js'), 'utf8')).toContain('jobs:alpha')
    expect(fs.readFileSync(path.join(convex, '_generated/api.ts'))).toEqual(original)
    write('convex/jobs.ts', moduleSource('bravo', runtime))
    result = run(runtime, [cli, 'generate', convex, '--mini'], root)
    expect(result.status, result.stderr).toBe(0)
    const output = fs.readFileSync(path.join(convex, '_zodvex/api.js'), 'utf8')
    expect(output).toContain('jobs:bravo')
    expect(output).not.toContain('jobs:alpha')
    expect(fs.readFileSync(path.join(convex, '_generated/api.ts'))).toEqual(original)
    expect(fs.readdirSync(root)).toContain('convex')
  })

  it('rejects different-project reuse before mutating its files', () => {
    const first = project()
    const second = project()
    const original = fs.readFileSync(path.join(second.convex, '_generated/api.ts'))
    const script = path.join(first.root, 'reuse.mjs')
    fs.writeFileSync(
      script,
      `
import { discoverModules } from ${JSON.stringify(codegen)};
await discoverModules(${JSON.stringify(first.convex)});
try { await discoverModules(${JSON.stringify(second.convex)}); process.exitCode = 1; }
catch (error) { if (!error.message.includes('fresh process')) throw error; }
`
    )
    const result = run(runtime, [script])
    expect(result.status, result.stderr).toBe(0)
    expect(fs.readFileSync(path.join(second.convex, '_generated/api.ts'))).toEqual(original)
  })
})
