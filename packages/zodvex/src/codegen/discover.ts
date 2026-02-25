import path from 'node:path'
import { Glob } from 'bun'
import { z } from 'zod'
import { readMeta, type ZodvexFunctionMeta, type ZodvexModelMeta } from '../meta'
import { extractCodec } from './extractCodec'

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

export type DiscoveredCodec = {
  exportName: string
  sourceFile: string
  schema: z.ZodTypeAny
}

export type ModelEmbeddedCodec = {
  codec: z.ZodTypeAny
  modelExportName: string
  modelSourceFile: string
  schemaKey: string
  fieldName: string
}

export type DiscoveryResult = {
  models: DiscoveredModel[]
  functions: DiscoveredFunction[]
  codecs: DiscoveredCodec[]
  modelCodecs: ModelEmbeddedCodec[]
}

/**
 * Walks a model's schema shapes to find embedded ZodCodec instances.
 * Uses extractCodec to unwrap ZodOptional/ZodNullable and find codecs.
 * Deduplicates by codec object identity.
 * Skips zx.date() (handled natively by zodToSource).
 */
export function walkModelCodecs(
  modelExportName: string,
  sourceFile: string,
  schemas: ZodvexModelMeta['schemas']
): ModelEmbeddedCodec[] {
  const found: ModelEmbeddedCodec[] = []
  const seen = new Set<z.ZodTypeAny>()

  for (const schemaKey of ['doc', 'insert', 'update'] as const) {
    const schema = schemas[schemaKey]
    if (!schema || !(schema instanceof z.ZodObject)) continue

    const shape = (schema._zod?.def as any)?.shape as Record<string, z.ZodTypeAny> | undefined
    if (!shape) continue

    for (const [fieldName, fieldSchema] of Object.entries(shape)) {
      const codec = extractCodec(fieldSchema)
      if (codec && !seen.has(codec)) {
        seen.add(codec)
        found.push({
          codec,
          modelExportName,
          modelSourceFile: sourceFile,
          schemaKey,
          fieldName
        })
      }
    }
  }

  return found
}

/**
 * Discovers all zodvex-decorated modules in a convex directory.
 * Imports each .ts/.js file, reads __zodvexMeta from exports,
 * and builds a registry of models and functions.
 */
export async function discoverModules(convexDir: string): Promise<DiscoveryResult> {
  const models: DiscoveredModel[] = []
  const functions: DiscoveredFunction[] = []
  const codecs: DiscoveredCodec[] = []

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

    // Derive module name from file path (strip extension, use forward slashes).
    // Used as-is for function paths — Convex's getFunctionName() returns the full
    // relative path including any subdirectory prefix (e.g. "api/reports:summary").
    const moduleName = file.replace(/\.(ts|js)$/, '').replace(/\\/g, '/')

    for (const [exportName, value] of Object.entries(moduleExports)) {
      const meta = readMeta(value)
      if (meta) {
        if (meta.type === 'model') {
          models.push({
            exportName,
            tableName: meta.tableName,
            sourceFile: file,
            schemas: meta.schemas
          })
        } else if (meta.type === 'function') {
          functions.push({
            functionPath: `${moduleName}:${exportName}`,
            exportName,
            sourceFile: file,
            zodArgs: meta.zodArgs,
            zodReturns: meta.zodReturns
          })
        }
      }

      // Check for exported ZodCodec instances (custom codecs)
      // Skip zx.date() — it's handled natively by zodToSource
      if (value instanceof z.ZodCodec) {
        const def = (value as any)._zod?.def as any
        const isZxDate = def?.in instanceof z.ZodNumber && def?.out instanceof z.ZodCustom
        if (!isZxDate) {
          // Deduplicate by object identity (same codec from re-exports)
          if (!codecs.some(c => c.schema === value)) {
            codecs.push({
              exportName,
              sourceFile: file,
              schema: value as z.ZodTypeAny
            })
          }
        }
      }
    }
  }

  const modelCodecs: ModelEmbeddedCodec[] = []
  for (const model of models) {
    const found = walkModelCodecs(model.exportName, model.sourceFile, model.schemas)
    modelCodecs.push(...found)
  }

  return { models, functions, codecs, modelCodecs }
}
