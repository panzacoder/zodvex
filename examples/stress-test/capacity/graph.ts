import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'

export interface GraphManifest {
  sourceHash: string
  emittedHash: string
  versions: { convex: string; esbuild: string; zod: string }
  entries: string[]
  queries: Record<string, {
    reachableBytes: number
    chunks: string[]
    profileInputs: string[]
    retainedUnusedModels: number
    retainedRegistryEntries: number
  }>
  checks: Record<string, boolean>
}

/** Audit the combined deployment graph; byte counts exclude source maps. */
export async function auditGraph(appDir: string, outputDir: string): Promise<GraphManifest> {
  appDir = resolve(appDir)
  outputDir = resolve(outputDir)
  const workingDir = dirname(appDir) // The generated app's Convex CLI project directory.
  const appRequire = createRequire(join(appDir, 'driver.ts'))
  const convexRequire = createRequire(appRequire.resolve('convex/package.json'))
  const esbuild: typeof import('esbuild') = convexRequire('esbuild')
  const versions = {
    convex: convexRequire('convex/package.json').version as string,
    esbuild: convexRequire('esbuild/package.json').version as string,
    zod: appRequire('zod/package.json').version as string,
  }
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      if (entry.name === '_generated' || /^[.#]/.test(entry.name)) return []
      const file = join(dir, entry.name)
      if (entry.isDirectory()) return walk(file)
      return entry.name.endsWith('.ts') && entry.name !== 'schema.ts' && entry.name.split('.').length === 2 && !file.includes(' ') ? [file] : []
    })
  }
  const entryPoints = walk(appDir).sort()
  const hash = createHash('sha256')
  for (const file of entryPoints) hash.update(relative(appDir, file)).update('\0').update(readFileSync(file)).update('\0')
  const bundleDir = join(outputDir, 'graph-bundle')
  // Match Convex innerEsbuild, including its own esbuild dependency version.
  const result = await esbuild.build({
    absWorkingDir: workingDir, entryPoints, bundle: true, platform: 'browser', format: 'esm',
    target: 'esnext', jsx: 'automatic', outdir: bundleDir, outbase: appDir,
    conditions: ['convex', 'module'], write: false, sourcemap: false, splitting: true,
    chunkNames: '_deps/[hash]', treeShaking: true, minifySyntax: true,
    minifyIdentifiers: true, minifyWhitespace: false, keepNames: true,
    define: { 'process.env.NODE_ENV': '"production"' }, metafile: true, logLevel: 'warning',
  })
  const outputs = new Map(Object.entries(result.metafile.outputs).map(([file, info]) => [resolve(workingDir, file), info]))
  const texts = new Map(result.outputFiles.map(file => [file.path, file.text]))
  const emittedHash = createHash('sha256')
  for (const file of [...result.outputFiles].sort((a, b) => a.path.localeCompare(b.path))) {
    emittedHash.update(relative(bundleDir, file.path)).update('\0').update(file.contents).update('\0')
  }
  const manifest: GraphManifest = { sourceHash: hash.digest('hex'), emittedHash: emittedHash.digest('hex'), versions, entries: entryPoints.map(file => relative(appDir, file)), queries: {}, checks: {} }
  for (const [file, info] of outputs) {
    if (!info.entryPoint) continue
    const name = relative(appDir, resolve(workingDir, info.entryPoint))
    if (name !== 'native.ts' && !name.endsWith('/query.ts')) continue
    const reachable = new Set<string>()
    function visit(output: string) {
      if (reachable.has(output)) return
      const node = outputs.get(output)
      if (!node) throw new Error(`Graph audit cannot resolve emitted module ${output}`)
      reachable.add(output)
      for (const imported of node.imports) {
        if (imported.external) throw new Error(`Graph audit found external import ${imported.path}`)
        const absolute = resolve(workingDir, imported.path)
        visit(outputs.has(absolute) ? absolute : resolve(dirname(output), imported.path))
      }
    }
    visit(file)
    const inputs = [...new Set([...reachable].flatMap(output => Object.entries(outputs.get(output)!.inputs).filter(([, input]) => input.bytesInOutput > 0).map(([input]) => input)))].sort()
    const profileInputs = inputs.map(input => relative(appDir, resolve(workingDir, input))).filter(input => /^(full|mini)_(lean|models|registry)\//.test(input))
    const source = [...reachable].map(output => texts.get(output)).join('\n')
    const row = {
      reachableBytes: [...reachable].reduce((sum, output) => sum + outputs.get(output)!.bytes, 0),
      chunks: [...reachable].filter(output => output !== file).map(output => relative(bundleDir, output)).sort(),
      profileInputs,
      retainedUnusedModels: new Set(source.match(/"unused\d+"/g) ?? []).size,
      retainedRegistryEntries: new Set(source.match(/unused\/fn\d+/g) ?? []).size,
    }
    manifest.queries[name] = row
    const hasZodvex = inputs.some(input => /(?:^|\/)zodvex\/(?:dist|src)\//.test(input))
    if (name === 'native.ts') manifest.checks.nativeHasNoZod = !hasZodvex && !inputs.some(input => /(?:^|\/)zod\//.test(input))
    if (name === 'helpers/query.ts') manifest.checks.helpersHasNoZodvex = !hasZodvex
    if (name.startsWith('mini_')) manifest.checks[`${name}:noClassic`] = !inputs.some(input => /\/zod\/.*\/classic\//.test(input))
    manifest.checks[`${name}:isolated`] = profileInputs.every(input => input.startsWith(`${name.split('/')[0]}/`))
    if (/_(models|registry)\//.test(name)) manifest.checks[`${name}:32Models`] = row.retainedUnusedModels === 31
    if (name.includes('_registry/')) manifest.checks[`${name}:128Entries`] = row.retainedRegistryEntries === 128
  }
  const expected = ['native.ts', 'helpers/query.ts', ...['full', 'mini'].flatMap(kind => ['lean', 'models', 'registry'].map(profile => `${kind}_${profile}/query.ts`))]
  manifest.checks.allVariantsPresent = expected.every(name => name in manifest.queries)
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(join(outputDir, 'graph-metafile.json'), JSON.stringify({ versions, options: { splitting: true, sourceMaps: false, entries: manifest.entries }, metafile: result.metafile }, null, 2))
  writeFileSync(join(outputDir, 'graph-manifest.json'), JSON.stringify(manifest, null, 2))
  const failed = Object.entries(manifest.checks).filter(([, passed]) => !passed).map(([name]) => name)
  if (failed.length) throw new Error(`Capacity graph audit failed: ${failed.join(', ')}`)
  return manifest
}
