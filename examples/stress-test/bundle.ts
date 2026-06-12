// Bundles a single entry point the way Convex's CLI does for isolate functions.
// Configuration is pulled from node_modules/convex/dist/esm/bundler/debugBundle.js
// (innerEsbuild) so the bundle topology matches what gets pushed to a deployment.
//
// Convex evaluates each entrypoint independently for memory budgeting since the
// recent backend change. We mirror that here: one esbuild call per entry, with
// splitting on so transitively-shared modules show up as separate chunks.

import { build, type BuildResult, type Metafile } from 'esbuild'
import { mkdirSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'

export interface BundleResult {
  entry: string
  outDir: string
  entryFile: string
  chunkFiles: string[]
  entryBytes: number
  chunkBytes: number
  totalBytes: number
  bundleTimeMs: number
  metafile: Metafile
}

export interface BundleOptions {
  entry: string
  outDir: string
  /** absolute path used as esbuild's outbase. Defaults to dirname(entry). */
  outbase?: string
  /** 'browser' (isolate, default) or 'node' (use-node actions). */
  platform?: 'browser' | 'node'
  /** Extra esbuild conditions on top of ['convex', 'module']. */
  extraConditions?: string[]
  /** If false, write to disk; if true, return bytes only. Default false. */
  inMemory?: boolean
}

export async function bundleEntry(opts: BundleOptions): Promise<BundleResult> {
  const {
    entry,
    outDir,
    outbase,
    platform = 'browser',
    extraConditions = [],
    inMemory = false,
  } = opts

  if (!existsSync(entry)) throw new Error(`entry not found: ${entry}`)

  if (!inMemory) {
    if (existsSync(outDir)) rmSync(outDir, { recursive: true })
    mkdirSync(outDir, { recursive: true })
  }

  const t0 = Date.now()

  // Mirrors innerEsbuild in convex/dist/esm/bundler/debugBundle.js.
  const result: BuildResult<{ write: false; metafile: true }> = await build({
    entryPoints: [entry],
    bundle: true,
    platform,
    format: 'esm',
    target: 'esnext',
    jsx: 'automatic',
    outdir: outDir,
    outbase: outbase ?? join(entry, '..'),
    conditions: ['convex', 'module', ...extraConditions],
    write: false,
    sourcemap: false,
    splitting: true,
    chunkNames: '_deps/[hash]',
    treeShaking: true,
    minifySyntax: true,
    minifyIdentifiers: true,
    minifyWhitespace: false,
    keepNames: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    metafile: true,
    logLevel: 'silent',
  })

  const bundleTimeMs = Date.now() - t0

  let entryFile = ''
  const chunkFiles: string[] = []
  let entryBytes = 0
  let chunkBytes = 0

  for (const out of result.outputFiles ?? []) {
    if (out.path.includes('_deps')) {
      chunkFiles.push(out.path)
      chunkBytes += out.contents.length
    } else {
      entryFile = out.path
      entryBytes += out.contents.length
    }
    if (!inMemory) {
      const { writeFileSync, mkdirSync: mk } = require('fs') as typeof import('fs')
      const { dirname } = require('path') as typeof import('path')
      mk(dirname(out.path), { recursive: true })
      writeFileSync(out.path, out.contents)
    }
  }

  return {
    entry,
    outDir,
    entryFile,
    chunkFiles,
    entryBytes,
    chunkBytes,
    totalBytes: entryBytes + chunkBytes,
    bundleTimeMs,
    metafile: result.metafile,
  }
}

// CLI: bun run bundle.ts --entry=path --out=path
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const entry = args.find(a => a.startsWith('--entry='))?.split('=')[1]
  const outDir = args.find(a => a.startsWith('--out='))?.split('=')[1]
  if (!entry || !outDir) throw new Error('--entry and --out required')
  const result = await bundleEntry({ entry, outDir })
  console.log(JSON.stringify({
    entry: result.entry,
    entryBytes: result.entryBytes,
    chunkBytes: result.chunkBytes,
    totalBytes: result.totalBytes,
    chunks: result.chunkFiles.length,
    bundleTimeMs: result.bundleTimeMs,
  }, null, 2))
}
