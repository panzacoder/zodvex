import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverModules } from '../codegen/discover'
import { withGenerationEnvironment } from '../codegen/discoveryEnvironment'
import {
  generateApiFile,
  generateClientFile,
  generateSchemaFile,
  generateServerFile
} from '../codegen/generate'

/**
 * One-shot codegen. Discovers modules, generates files.
 */
export async function generate(convexDir?: string, options?: { mini?: boolean }): Promise<void> {
  const resolved = resolveConvexDir(convexDir)
  const result = await withGenerationEnvironment(resolved, async () => {
    const result = await discoverModules(resolved)
    const schema = generateSchemaFile(result.models)
    const api = generateApiFile(
      result.functions,
      result.models,
      result.codecs,
      result.modelCodecs,
      result.functionCodecs,
      { mini: options?.mini }
    )
    const client = generateClientFile({ mini: options?.mini })
    const server = generateServerFile()
    return {
      result,
      output: {
        'schema.js': schema.js,
        'schema.d.ts': schema.dts,
        'api.js': api.js,
        'api.d.ts': api.dts,
        'client.js': client.js,
        'client.d.ts': client.dts,
        'server.js': server.js,
        'server.d.ts': server.dts
      }
    }
  })

  const totalCodecs =
    result.codecs.length + result.modelCodecs.length + result.functionCodecs.length
  console.log(
    `[zodvex] Generated ${result.models.length} model(s), ${result.functions.length} function(s), ${totalCodecs} codec(s)`
  )
}

/**
 * Watch mode. Runs generate() once, then watches for changes.
 */
export async function dev(convexDir?: string, options?: { mini?: boolean }): Promise<void> {
  const resolved = resolveConvexDir(convexDir)

  console.log('[zodvex] Starting watch mode...')
  await generate(resolved, options)

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const watcher = fs.watch(resolved, { recursive: true }, (_event, filename) => {
    if (!filename) return
    // Skip generated directories and non-TS files
    if (
      filename.startsWith('_zodvex') ||
      filename.startsWith('_generated') ||
      (!filename.endsWith('.ts') && !filename.endsWith('.js'))
    ) {
      return
    }

    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      console.log('[zodvex] Regenerating...')
      // Spawn a fresh `generate` subprocess rather than regenerating in-process.
      // A long-lived watcher can't reliably re-import edited modules: Bun's
      // loader caches ESM by resolved path and ignores query-string busting, so
      // an in-process regen emits stale output. A fresh process starts with an
      // empty module cache and always sees the latest source.
      void regenerate(resolved, options)
    }, 300)
  })

  // Keep process alive
  process.on('SIGINT', () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    watcher.close()
    process.exit(0)
  })
}

/**
 * Regenerate in a fresh subprocess. The dev watcher cannot re-import edited
 * modules in-process under Bun (it caches ESM by resolved path and ignores
 * query-string cache-busting), so each change spawns a one-shot `zodvex
 * generate`, which starts with an empty module cache and always sees the
 * latest source. Runtime-agnostic by construction.
 *
 * @internal Exported for tests; not part of the public API.
 */
export function regenerate(resolved: string, options?: { mini?: boolean }): Promise<void> {
  const cliEntry = fileURLToPath(new URL('./index.js', import.meta.url))
  const args = [cliEntry, 'generate', resolved]
  if (options?.mini) args.push('--mini')
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' })
    child.on('exit', code => {
      if (code !== 0) console.error(`[zodvex] Regeneration exited with code ${code}`)
      resolve()
    })
    child.on('error', err => {
      console.error('[zodvex] Failed to spawn regeneration:', err.message)
      resolve()
    })
  })
}

function resolveConvexDir(dir?: string): string {
  if (dir) {
    const resolved = path.resolve(dir)
    if (!fs.existsSync(resolved)) {
      throw new Error(`Convex directory not found: ${resolved}`)
    }
    return resolved
  }

  // Default: look for ./convex/ in cwd
  const defaultDir = path.resolve('convex')
  if (!fs.existsSync(defaultDir)) {
    throw new Error('No convex/ directory found. Specify the path: zodvex generate <path>')
  }
  return defaultDir
}
