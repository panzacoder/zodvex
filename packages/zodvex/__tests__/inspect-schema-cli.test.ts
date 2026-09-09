import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'

const require = createRequire(import.meta.url)
const packageRoot = path.resolve(__dirname, '..')
const privateMarker = 'private_diagnostic_sentinel'
let directory: string
let consumer: string
let installedPackage: string
let cli: string
let archiveFiles: string[]

function command(
  args: string[],
  options: { cwd?: string; preload?: string; env?: NodeJS.ProcessEnv } = {}
) {
  return spawnSync(
    'node',
    [
      ...(options.preload
        ? ['--import', `data:text/javascript,${encodeURIComponent(options.preload)}`]
        : []),
      cli,
      ...args
    ],
    {
      cwd: options.cwd ?? consumer,
      env: { ...process.env, ...options.env },
      encoding: 'utf8',
      timeout: 15000
    }
  )
}

function writeSchema(relative: string, source: string) {
  const file = path.join(consumer, relative)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, source)
  return file
}

function expectPrivateFailure(result: ReturnType<typeof command>) {
  expect(result.status, result.stderr).toBe(1)
  expect(result.stdout).toBe('')
  expect(result.stderr).toContain('no report was produced')
  expect(result.stderr).not.toContain(privateMarker)
  expect(result.stderr).not.toContain(directory)
}

beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'zodvex-packed-inspect-'))
  consumer = path.join(directory, 'consumer')
  const nodeModules = path.join(consumer, 'node_modules')
  mkdirSync(nodeModules, { recursive: true })
  writeFileSync(path.join(consumer, 'package.json'), '{"private":true,"type":"module"}')
  const archive = path.join(directory, 'zodvex.tgz')
  const packed = spawnSync(
    'bun',
    ['pm', 'pack', '--ignore-scripts', '--quiet', '--filename', archive],
    {
      cwd: packageRoot,
      encoding: 'utf8',
      timeout: 30000
    }
  )
  expect(packed.status, packed.stderr).toBe(0)
  const listed = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' })
  expect(listed.status, listed.stderr).toBe(0)
  archiveFiles = listed.stdout
    .trim()
    .split('\n')
    .map(file => file.replace(/^package\//, ''))
  const unpacked = spawnSync('tar', ['-xzf', archive, '-C', directory], { encoding: 'utf8' })
  expect(unpacked.status, unpacked.stderr).toBe(0)
  installedPackage = path.join(directory, 'package')
  // The package under test comes from the real archive, outside the checkout.
  // Reuse installed third-party dependencies so this test needs no network.
  symlinkSync(installedPackage, path.join(nodeModules, 'zodvex'), 'dir')
  const installedNodeModules = path.join(installedPackage, 'node_modules')
  mkdirSync(installedNodeModules)
  for (const name of ['zod', 'convex', 'convex-helpers', 'tinyglobby', 'ts-morph']) {
    let root = path.dirname(require.resolve(name))
    while (
      !existsSync(path.join(root, 'package.json')) ||
      JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).name !== name
    ) {
      root = path.dirname(root)
    }
    symlinkSync(root, path.join(nodeModules, name), 'dir')
    symlinkSync(root, path.join(installedNodeModules, name), 'dir')
  }
  cli = path.join(installedPackage, 'dist/cli/index.js')
}, 40000)

afterAll(() => {
  if (directory) rmSync(directory, { recursive: true, force: true })
})

test('the built archive includes the diagnostic module, worker, and census', () => {
  expect(archiveFiles).toEqual(
    expect.arrayContaining([
      'dist/cli/inspect-schema/inspect.mjs',
      'dist/cli/inspect-schema/inspect-worker.mjs',
      'dist/cli/inspect-schema/census.mjs'
    ])
  )
})

test('inspect-schema help succeeds without resolving an application schema or dependencies', () => {
  const empty = path.join(directory, 'empty')
  mkdirSync(empty)
  const result = command(['inspect-schema', '--help'], { cwd: empty })
  expect(result.status, result.stderr).toBe(0)
  expect(result.stderr).toBe('')
  expect(result.stdout).toContain('convex/schema.ts')
  expect(result.stdout).toContain('Node 22')
})

test('the packed command defaults to convex/schema.ts and emits only aggregate JSON', () => {
  writeSchema(
    'convex/schema.ts',
    `
    import { defineZodModel } from 'zodvex'
    import { defineZodSchema } from 'zodvex/server'
    import { z } from 'zod'
    console.log('${privateMarker}_stdout')
    console.error('${privateMarker}_stderr')
    const ${privateMarker} = defineZodModel('${privateMarker}', {
      ${privateMarker}_field: z.literal('${privateMarker}_value')
    })
    export default defineZodSchema({ ${privateMarker} })
  `
  )
  const result = command(['inspect-schema'])
  expect(result.status, result.stderr).toBe(0)
  expect(result.stderr).toBe('')
  expect(result.stdout).not.toContain(privateMarker)
  expect(result.stdout).not.toContain(directory)
  const report = JSON.parse(result.stdout)
  expect(Object.keys(report)).toEqual([
    'format',
    'runtime',
    'versions',
    'census',
    'localImport',
    'scope'
  ])
  expect(report).toMatchObject({
    format: 'zodvex-local-schema-report-v1',
    census: { models: 1, schemaRoots: 2, definitionTraversalComplete: true },
    localImport: { repetitions: 3 }
  })
  expect(report.versions.zodvex).toBe(
    JSON.parse(readFileSync(path.join(installedPackage, 'package.json'), 'utf8')).version
  )
  expect(Number.isFinite(report.localImport.heapUsed.medianDeltaBytes)).toBe(true)
})

test('an explicit schema path is used instead of the default', () => {
  const file = writeSchema(
    'other/schema.ts',
    `
    import { defineZodModel } from 'zodvex'
    import { defineZodSchema } from 'zodvex/server'
    import { z } from 'zod'
    export default defineZodSchema({
      first: defineZodModel('first', { value: z.string() }),
      second: defineZodModel('second', { value: z.number() })
    })
  `
  )
  const result = command(['inspect-schema', file])
  expect(result.status, result.stderr).toBe(0)
  expect(JSON.parse(result.stdout).census.models).toBe(2)
})

test.each([
  [
    `${privateMarker}-throws.ts`,
    `console.log('${privateMarker}'); throw new Error('${privateMarker}'); export default {}`
  ],
  [`${privateMarker}-syntax.ts`, `export default ${privateMarker} {{{`],
  [`${privateMarker}-exports.ts`, `export default { ${privateMarker}: 'not a schema' }`]
])('failures in %s keep application source and paths out of both output streams', (name, source) => {
  expectPrivateFailure(command(['inspect-schema', writeSchema(name, source)]))
})

test('a missing explicit schema fails without disclosing its path', () => {
  expectPrivateFailure(
    command(['inspect-schema', path.join(consumer, `${privateMarker}-missing.ts`)])
  )
})

test('temporary-directory setup failures do not disclose environment paths', () => {
  expectPrivateFailure(
    command(['inspect-schema'], {
      env: { TMPDIR: path.join(consumer, `${privateMarker}-missing-temp-parent`) }
    })
  )
})

test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
  'cleanup failures are sanitized and suppress the report',
  () => {
    const temporaryParent = path.join(consumer, `${privateMarker}-temporary-parent`)
    mkdirSync(temporaryParent)
    const schema = writeSchema(
      'cleanup.ts',
      `
    import { chmodSync } from 'node:fs'
    import { dirname } from 'node:path'
    import { fileURLToPath } from 'node:url'
    import { defineZodModel } from 'zodvex'
    import { defineZodSchema } from 'zodvex/server'
    import { z } from 'zod'
    chmodSync(dirname(fileURLToPath(import.meta.url)), 0o555)
    export default defineZodSchema({ sample: defineZodModel('sample', { value: z.string() }) })
  `
    )
    try {
      expectPrivateFailure(
        command(['inspect-schema', schema], { env: { TMPDIR: temporaryParent } })
      )
    } finally {
      for (const entry of readdirSync(temporaryParent))
        chmodSync(path.join(temporaryParent, entry), 0o755)
    }
  }
)

test.each([
  ['--unknown-private-option'],
  [`${privateMarker}.ts`, 'extra.ts'],
  ['--help', `${privateMarker}.ts`]
])('invalid arguments fail before schema import: %j', (...args) => {
  const result = command(['inspect-schema', ...args])
  expect(result.status).toBe(1)
  expect(result.stdout).toBe('')
  expect(result.stderr).toContain('Usage: zodvex inspect-schema')
  expect(result.stderr).not.toContain(privateMarker)
})

test('only diagnostic execution requires Node 22, while ordinary CLI help still works', () => {
  const preload = `Object.defineProperty(process.versions, 'node', { value: '20.19.0' })`
  const diagnostic = command(['inspect-schema'], { preload })
  expect(diagnostic.status).toBe(1)
  expect(diagnostic.stdout).toBe('')
  expect(diagnostic.stderr).toContain('Node 22')
  const help = command(['help'], { preload })
  expect(help.status, help.stderr).toBe(0)
  expect(help.stdout).toContain('inspect-schema')
})

test('ordinary CLI help does not load the diagnostic module', () => {
  const diagnostic = path.join(installedPackage, 'dist/cli/inspect-schema/inspect.mjs')
  const previous = readFileSync(diagnostic, 'utf8')
  try {
    writeFileSync(diagnostic, 'throw new Error("diagnostic eagerly loaded")')
    const result = command(['help'])
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toBe('')
  } finally {
    writeFileSync(diagnostic, previous)
  }
})
