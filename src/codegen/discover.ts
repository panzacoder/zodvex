import { readMeta, type ZodvexFunctionMeta, type ZodvexModelMeta } from '../meta'
import { Glob } from 'bun'
import path from 'node:path'

export type DiscoveredModel = {
  exportName: string
  tableName: string
  sourceFile: string
  schemas: ZodvexModelMeta['schemas']
}

export type DiscoveredFunction = {
  functionPath: string
  exportName: string
  sourceFile: string
  zodArgs?: ZodvexFunctionMeta['zodArgs']
  zodReturns?: ZodvexFunctionMeta['zodReturns']
}

export type DiscoveryResult = {
  models: DiscoveredModel[]
  functions: DiscoveredFunction[]
}

/**
 * Discovers all zodvex-decorated modules in a convex directory.
 * Imports each .ts/.js file, reads __zodvexMeta from exports,
 * and builds a registry of models and functions.
 */
export async function discoverModules(convexDir: string): Promise<DiscoveryResult> {
  const models: DiscoveredModel[] = []
  const functions: DiscoveredFunction[] = []

  const glob = new Glob('**/*.{ts,js}')
  const files: string[] = []
  for await (const file of glob.scan({ cwd: convexDir })) {
    // Skip excluded directories and declaration files
    if (
      file.startsWith('_generated/') ||
      file.startsWith('_zodvex/') ||
      file.startsWith('node_modules/') ||
      file.endsWith('.d.ts')
    ) {
      continue
    }
    files.push(file)
  }

  for (const file of files) {
    const absPath = path.resolve(convexDir, file)

    let moduleExports: Record<string, unknown>
    try {
      moduleExports = await import(absPath)
    } catch (err) {
      console.warn(`[zodvex] Warning: Failed to import ${file}:`, (err as Error).message)
      continue
    }

    // Derive module name from file path (strip extension, use forward slashes)
    const moduleName = file.replace(/\.(ts|js)$/, '').replace(/\\/g, '/')
    // For nested paths like models/user, keep the full path
    // But for function paths, use the last segment (Convex convention)
    const moduleBase = moduleName.includes('/') ? moduleName.split('/').pop()! : moduleName

    for (const [exportName, value] of Object.entries(moduleExports)) {
      const meta = readMeta(value)
      if (!meta) continue

      if (meta.type === 'model') {
        models.push({
          exportName,
          tableName: meta.tableName,
          sourceFile: file,
          schemas: meta.schemas
        })
      } else if (meta.type === 'function') {
        functions.push({
          functionPath: `${moduleBase}:${exportName}`,
          exportName,
          sourceFile: file,
          zodArgs: meta.zodArgs,
          zodReturns: meta.zodReturns
        })
      }
    }
  }

  return { models, functions }
}
