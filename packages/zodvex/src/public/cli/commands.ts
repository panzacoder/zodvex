import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverModules } from '../codegen/discover'
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
  const zodvexDir = path.join(resolved, '_zodvex')

  // Ensure _zodvex/api.js exists before discovery. User modules (e.g., functions.ts)
  // may import zodvexRegistry from it. Without a stub, dynamic import() fails and
  // codegen can't discover those modules — a chicken-and-egg problem.
  // Stubbing overwrites the previous generation, so if anything below throws
  // (e.g. the strict import-failure error), restore the originals: a failed
  // run must not clobber a good checked-in registry (#104).
  const restoreStubbedApi = writeStubApi(zodvexDir)

  let result: Awaited<ReturnType<typeof discoverModules>>
  let schemaContent: ReturnType<typeof generateSchemaFile>
  let apiContent: ReturnType<typeof generateApiFile>
  let clientContent: ReturnType<typeof generateClientFile>
  let serverContent: ReturnType<typeof generateServerFile>
  try {
    result = await discoverModules(resolved)

    schemaContent = generateSchemaFile(result.models)
    apiContent = generateApiFile(
      result.functions,
      result.models,
      result.codecs,
      result.modelCodecs,
      result.functionCodecs,
      { mini: options?.mini }
    )
    clientContent = generateClientFile({ mini: options?.mini })
    serverContent = generateServerFile()
  } catch (err) {
    restoreStubbedApi()
    throw err
  }

  fs.mkdirSync(zodvexDir, { recursive: true })
  writeIfChanged(path.join(zodvexDir, 'schema.js'), schemaContent.js)
  writeIfChanged(path.join(zodvexDir, 'schema.d.ts'), schemaContent.dts)
  writeIfChanged(path.join(zodvexDir, 'api.js'), apiContent.js)
  writeIfChanged(path.join(zodvexDir, 'api.d.ts'), apiContent.dts)
  writeIfChanged(path.join(zodvexDir, 'client.js'), clientContent.js)
  writeIfChanged(path.join(zodvexDir, 'client.d.ts'), clientContent.dts)
  writeIfChanged(path.join(zodvexDir, 'server.js'), serverContent.js)
  writeIfChanged(path.join(zodvexDir, 'server.d.ts'), serverContent.dts)

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

/** Writes minimal stub _zodvex/api.js + api.d.ts before discovery to break circular imports.
 *  Previous generations may contain stale imports that cause cycles during re-discovery.
 *
 *  Returns a restore closure that puts the pre-existing files back (or removes
 *  the stubs if there were none) — called when generation fails so a failed
 *  run doesn't leave the gutted stub in place of a good registry (#104). */
function writeStubApi(zodvexDir: string): () => void {
  const stubTargets = ['api.js', 'api.d.ts'].map(name => {
    const filePath = path.join(zodvexDir, name)
    let original: string | null
    try {
      original = fs.readFileSync(filePath, 'utf-8')
    } catch {
      original = null
    }
    return { filePath, original }
  })

  fs.mkdirSync(zodvexDir, { recursive: true })

  fs.writeFileSync(
    path.join(zodvexDir, 'api.js'),
    '// AUTO-GENERATED by zodvex — do not edit\n// Stub created for codegen bootstrap\n\nexport const zodvexRegistry = {}\n'
  )

  fs.writeFileSync(
    path.join(zodvexDir, 'api.d.ts'),
    '// AUTO-GENERATED by zodvex — do not edit\n// Stub created for codegen bootstrap\n\nexport declare const zodvexRegistry: Record<string, any>\n'
  )

  return () => {
    for (const { filePath, original } of stubTargets) {
      try {
        if (original !== null) {
          fs.writeFileSync(filePath, original)
        } else {
          fs.unlinkSync(filePath)
        }
      } catch {
        // Best-effort restore — the thrown generation error is the headline.
      }
    }
  }
}

/** Only write if content differs from what's on disk — prevents file watcher loops. */
function writeIfChanged(filePath: string, content: string): void {
  try {
    const existing = fs.readFileSync(filePath, 'utf-8')
    if (existing === content) return
  } catch {
    // File doesn't exist yet — write it
  }
  fs.writeFileSync(filePath, content)
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
