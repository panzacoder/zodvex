import path from 'node:path'
import { globSync } from 'tinyglobby'
import { readMeta, type ZodvexFunctionMeta, type ZodvexModelMeta } from '../../internal/meta'
import {
  $ZodArray,
  $ZodCodec,
  $ZodCustom,
  $ZodNullable,
  $ZodNumber,
  $ZodObject,
  $ZodOptional,
  $ZodRecord,
  $ZodTuple,
  $ZodType,
  $ZodUnion
} from '../../internal/zod-core'
import { registerDiscoveryHooks, writeGeneratedStubs } from './discovery-hooks'
import { findCodec } from './extractCodec'

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
  schema: $ZodType
}

export type ModelEmbeddedCodec = {
  codec: $ZodType
  modelExportName: string
  modelSourceFile: string
  schemaKey: string
  /** Path expression from schema root, e.g. '.shape.email' or '.shape.payload._zod.def.options[0].shape.name' */
  accessPath: string
}

export type FunctionEmbeddedCodec = {
  codec: $ZodType
  functionExportName: string
  functionSourceFile: string
  schemaSource: 'zodArgs' | 'zodReturns'
  accessPath: string
}

export type DiscoveryResult = {
  models: DiscoveredModel[]
  functions: DiscoveredFunction[]
  codecs: DiscoveredCodec[]
  modelCodecs: ModelEmbeddedCodec[]
  functionCodecs: FunctionEmbeddedCodec[]
}

/**
 * Recursively walks a Zod schema tree to find embedded ZodCodec instances.
 * Navigates into ZodObject shapes, ZodUnion/ZodArray/ZodRecord/ZodTuple members,
 * and unwraps ZodOptional/ZodNullable at intermediate levels.
 *
 * Builds an access path string for each discovered codec that can be used
 * in generated code to navigate from the schema root to the codec's location.
 */
function walkSchemaRecursive(
  schema: $ZodType,
  accessPath: string,
  visited: Set<$ZodType>,
  seenCodecs: Set<$ZodType>,
  results: { codec: $ZodType; accessPath: string }[]
): void {
  if (visited.has(schema)) return
  visited.add(schema)

  // Check if this node is/contains a codec (findCodec unwraps optional/nullable)
  const codec = findCodec(schema)
  if (codec) {
    if (!seenCodecs.has(codec)) {
      seenCodecs.add(codec)
      results.push({ codec, accessPath })
    }
    return // Codec is a leaf — don't recurse into its internals
  }

  // Unwrap optional/nullable to get to the structural type
  let current: $ZodType = schema
  let currentPath = accessPath
  for (let i = 0; i < 10; i++) {
    if (current instanceof $ZodOptional || current instanceof $ZodNullable) {
      current = current._zod.def.innerType
      currentPath += '._zod.def.innerType'
    } else {
      break
    }
  }

  if (current instanceof $ZodObject) {
    const shape = current._zod.def.shape as Record<string, $ZodType>
    if (shape) {
      for (const [field, fieldSchema] of Object.entries(shape)) {
        walkSchemaRecursive(
          fieldSchema,
          `${currentPath}.shape.${field}`,
          visited,
          seenCodecs,
          results
        )
      }
    }
  } else if (current instanceof $ZodUnion) {
    const options = current._zod.def.options
    if (options) {
      for (let i = 0; i < options.length; i++) {
        walkSchemaRecursive(
          options[i],
          `${currentPath}._zod.def.options[${i}]`,
          visited,
          seenCodecs,
          results
        )
      }
    }
  } else if (current instanceof $ZodArray) {
    const element = current._zod.def.element
    if (element) {
      walkSchemaRecursive(element, `${currentPath}._zod.def.element`, visited, seenCodecs, results)
    }
  } else if (current instanceof $ZodRecord) {
    const valueType = current._zod.def.valueType
    if (valueType) {
      walkSchemaRecursive(
        valueType,
        `${currentPath}._zod.def.valueType`,
        visited,
        seenCodecs,
        results
      )
    }
  } else if (current instanceof $ZodTuple) {
    const items = current._zod.def.items
    if (items) {
      for (let i = 0; i < items.length; i++) {
        walkSchemaRecursive(
          items[i],
          `${currentPath}._zod.def.items[${i}]`,
          visited,
          seenCodecs,
          results
        )
      }
    }
  }
}

/**
 * Walks a model's schema shapes to find embedded ZodCodec instances.
 * Recursively descends into objects, unions, arrays, records, and tuples.
 * Deduplicates by codec object identity across schema keys.
 * Skips zx.date() (handled natively by zodToSource via extractCodec).
 */
export function walkModelCodecs(
  modelExportName: string,
  sourceFile: string,
  schemas: ZodvexModelMeta['schemas']
): ModelEmbeddedCodec[] {
  const found: ModelEmbeddedCodec[] = []
  const visited = new Set<$ZodType>()
  const seenCodecs = new Set<$ZodType>()

  for (const schemaKey of ['doc', 'insert', 'update'] as const) {
    const schema = schemas[schemaKey]
    if (!schema) continue

    const results: { codec: $ZodType; accessPath: string }[] = []
    walkSchemaRecursive(schema as $ZodType, '', visited, seenCodecs, results)

    for (const r of results) {
      found.push({
        codec: r.codec,
        modelExportName,
        modelSourceFile: sourceFile,
        schemaKey,
        accessPath: r.accessPath
      })
    }
  }

  return found
}

/**
 * Walks a function's zodArgs and zodReturns schemas to find embedded ZodCodec instances.
 * Same recursive descent as walkModelCodecs, but uses function metadata as the entry point.
 */
export function walkFunctionCodecs(functions: DiscoveredFunction[]): FunctionEmbeddedCodec[] {
  const found: FunctionEmbeddedCodec[] = []
  const visited = new Set<$ZodType>()
  const seenCodecs = new Set<$ZodType>()

  for (const fn of functions) {
    for (const schemaSource of ['zodArgs', 'zodReturns'] as const) {
      const schema = schemaSource === 'zodArgs' ? fn.zodArgs : fn.zodReturns
      if (!schema) continue

      const results: { codec: $ZodType; accessPath: string }[] = []
      walkSchemaRecursive(schema as $ZodType, '', visited, seenCodecs, results)

      for (const r of results) {
        found.push({
          codec: r.codec,
          functionExportName: fn.exportName,
          functionSourceFile: fn.sourceFile,
          schemaSource,
          accessPath: r.accessPath
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

  // Stub _generated/api so module-scope code that accesses Convex components
  // (e.g. `new LocalDTA(components.localDTA)`) receives a harmless Proxy
  // instead of throwing outside the Convex runtime. _generated/server is NOT
  // stubbed — it re-exports generic builders from convex/server which work natively.
  registerDiscoveryHooks()
  const cleanupStubs = writeGeneratedStubs(convexDir)

  const files = globSync(['**/*.{ts,js}'], {
    cwd: convexDir,
    onlyFiles: true,
    ignore: [
      '_generated/**',
      '_zodvex/**',
      'node_modules/**',
      '**/*.d.ts',
      '**/*.test.ts',
      '**/*.test.js',
      '**/*.spec.ts',
      '**/*.spec.js',
      'convex.config.ts',
      'convex.config.js',
      'crons.ts',
      'crons.js'
    ]
  })

  try {
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
            const isBarrel = /(?:^|[\\/])index\.(ts|js)$/.test(file)
            const existing = models.findIndex(m => m.tableName === meta.tableName)
            if (existing >= 0) {
              // Replace barrel source with direct module source
              const existingIsBarrel = /(?:^|[\\/])index\.(ts|js)$/.test(
                models[existing].sourceFile
              )
              if (existingIsBarrel && !isBarrel) {
                models[existing] = {
                  exportName,
                  tableName: meta.tableName,
                  sourceFile: file,
                  schemas: meta.schemas
                }
              }
              // If existing is direct and new is barrel, skip
            } else {
              models.push({
                exportName,
                tableName: meta.tableName,
                sourceFile: file,
                schemas: meta.schemas
              })
            }
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
        if (value instanceof $ZodCodec) {
          const isZxDate =
            value._zod.def.in instanceof $ZodNumber && value._zod.def.out instanceof $ZodCustom
          if (!isZxDate) {
            // Deduplicate by object identity (same codec from re-exports)
            if (!codecs.some(c => c.schema === value)) {
              codecs.push({
                exportName,
                sourceFile: file,
                schema: value as $ZodType
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

    const functionCodecs = walkFunctionCodecs(functions)

    return { models, functions, codecs, modelCodecs, functionCodecs }
  } finally {
    cleanupStubs()
  }
}
