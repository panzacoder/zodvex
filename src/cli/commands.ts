import fs from 'node:fs'
import path from 'node:path'
import { discoverModules } from '../codegen/discover'
import { generateSchemaFile, generateValidatorsFile } from '../codegen/generate'

/**
 * One-shot codegen. Discovers modules, generates files.
 */
export async function generate(convexDir?: string): Promise<void> {
  const resolved = resolveConvexDir(convexDir)
  const zodvexDir = path.join(resolved, '_zodvex')

  const result = await discoverModules(resolved)

  const schemaContent = generateSchemaFile(result.models)
  const validatorsContent = generateValidatorsFile(result.functions, result.models)

  fs.mkdirSync(zodvexDir, { recursive: true })
  fs.writeFileSync(path.join(zodvexDir, 'schema.ts'), schemaContent)
  fs.writeFileSync(path.join(zodvexDir, 'validators.ts'), validatorsContent)

  console.log(
    `[zodvex] Generated ${result.models.length} model(s), ${result.functions.length} function(s)`
  )
}

/**
 * Watch mode. Runs generate() once, then watches for changes.
 */
export async function dev(convexDir?: string): Promise<void> {
  const resolved = resolveConvexDir(convexDir)

  console.log('[zodvex] Starting watch mode...')
  await generate(resolved)

  const watcher = fs.watch(resolved, { recursive: true }, async (_event, filename) => {
    if (!filename) return
    // Skip generated directories and non-TS files
    if (
      filename.startsWith('_zodvex') ||
      filename.startsWith('_generated') ||
      (!filename.endsWith('.ts') && !filename.endsWith('.js'))
    ) {
      return
    }

    console.log(`[zodvex] Change detected: ${filename}`)
    try {
      await generate(resolved)
    } catch (err) {
      console.error('[zodvex] Generation failed:', (err as Error).message)
    }
  })

  // Keep process alive
  process.on('SIGINT', () => {
    watcher.close()
    process.exit(0)
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
