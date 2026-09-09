// Experimental support diagnostic. Runs locally; does not call Convex or upload.
import { fork } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

export async function inspectSchema(args) {
  const usage = 'Usage: zodvex inspect-schema [schema-file]'
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(
      `${usage}\n\nDefaults to convex/schema.ts in the current directory. Requires Node 22+.\nWrites an aggregate JSON report to stdout; redirect it to schema-report.json.\nImports your trusted schema locally, including module initializers.\nNo upload or deployment. Local measurements do not predict Convex capacity.`
    )
    return
  }
  if (args.length > 1 || args[0]?.startsWith('-')) {
    console.error(usage)
    process.exitCode = 1
    return
  }
  if (process.versions.bun || Number(process.versions.node.split('.')[0]) < 22) {
    console.error('Use Node 22+ to run zodvex inspect-schema; no report was produced')
    process.exitCode = 1
    return
  }
  let directory
  let output
  let stage = 'temporary setup'
  try {
    const input = args[0] ?? 'convex/schema.ts'
    const schemaPath = resolve(input)
    const require = createRequire(schemaPath)
    directory = mkdtempSync(join(tmpdir(), 'zodvex-schema-inspect-'))
    const worker = fileURLToPath(new URL('./inspect-worker.mjs', import.meta.url))
    const version = name => {
      try {
        let packagePath
        try {
          packagePath = require.resolve(name + '/package.json')
        } catch {
          let parent = dirname(require.resolve(name))
          while (true) {
            try {
              const file = join(parent, 'package.json')
              if (JSON.parse(readFileSync(file, 'utf8')).name === name) {
                packagePath = file
                break
              }
            } catch {
              // This ancestor is not the package root; continue without exposing it.
            }
            const next = dirname(parent)
            if (next === parent) return null
            parent = next
          }
        }
        const value = JSON.parse(readFileSync(packagePath, 'utf8')).version
        return /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(value) ? value : null
      } catch {
        return null
      }
    }
    async function sample(bundle) {
      return new Promise((resolve, reject) => {
        const child = fork(worker, [bundle], {
          execArgv: ['--expose-gc', '--max-old-space-size=512'],
          stdio: ['ignore', 'ignore', 'ignore', 'ipc']
        })
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          reject(new Error('Local diagnostic exceeded its 20-second budget'))
        }, 20000)
        let result
        child.on('message', value => {
          result = value
        })
        child.on('error', () => {
          clearTimeout(timer)
          reject(new Error('Could not start Node diagnostic'))
        })
        child.on('exit', code => {
          clearTimeout(timer)
          if (code !== 0 || result?.ok !== true)
            reject(
              new Error(
                'Schema could not be imported and inspected locally; no report was produced'
              )
            )
          else resolve(result)
        })
      })
    }
    stage = 'dependency resolution'
    const esbuild = createRequire(require.resolve('convex/package.json'))('esbuild')
    stage = 'bundling'
    const { outputFiles, metafile } = await esbuild.build({
      entryPoints: [schemaPath],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      conditions: ['convex', 'module'],
      treeShaking: true,
      write: false,
      metafile: true,
      sourcemap: false,
      logLevel: 'silent'
    })
    const bundle = join(directory, 'schema.mjs')
    writeFileSync(bundle, outputFiles[0].contents, { mode: 0o600 })
    stage = 'schema import and inspection'
    const samples = []
    for (let i = 0; i < 3; i++) samples.push(await sample(bundle))
    if (samples.some(row => !isDeepStrictEqual(row.census, samples[0].census)))
      throw new Error(
        'Schema structure changed between imports; no deterministic census was produced'
      )
    const metrics = Object.fromEntries(
      ['heapUsed', 'external', 'arrayBuffers'].map(key => {
        const values = samples.map(row => row.after[key] - row.before[key]).sort((a, b) => a - b)
        return [
          key,
          {
            medianDeltaBytes: values[1],
            minDeltaBytes: values[0],
            maxDeltaBytes: values[2]
          }
        ]
      })
    )
    output = JSON.stringify(
      {
        format: 'zodvex-local-schema-report-v1',
        runtime: {
          node: process.version,
          v8: process.versions.v8,
          platform: process.platform,
          arch: process.arch
        },
        versions: {
          convex: version('convex'),
          zod: version('zod'),
          zodvex: version('zodvex'),
          esbuild: esbuild.version
        },
        census: samples[0].census,
        localImport: {
          repetitions: 3,
          ...metrics,
          bundledBytes: outputFiles[0].contents.length,
          bundledModules: Object.keys(metafile.inputs).length
        },
        scope:
          'Definition census covers exported doc/insert schemas; local Node import deltas include bundled dependencies and reachable module state. Not Convex heap bytes, runtime peak, or a capacity prediction. External includes ArrayBuffers; do not add them.'
      },
      null,
      2
    )
  } catch {
    // Do not echo esbuild errors, application messages, paths or source snippets.
    console.error(`Local schema diagnostic failed during ${stage}; no report was produced`)
    process.exitCode = 1
  } finally {
    try {
      if (directory) rmSync(directory, { recursive: true, force: true })
    } catch {
      output = undefined
      console.error(
        'Local schema diagnostic failed during temporary cleanup; no report was produced'
      )
      process.exitCode = 1
    }
  }
  if (output !== undefined) console.log(output)
}
