import path from 'node:path'
import { globSync } from 'tinyglobby'
import { z } from 'zod'
import { readMeta, type ZodvexFunctionMeta, type ZodvexModelMeta } from '../../internal/meta'
import { createSchemaUpdateSchema } from '../../internal/modelSchemaBundle'
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
import { zx } from '../../internal/zx'
import { registerDiscoveryHooks, writeGeneratedStubs } from './discovery-hooks'
import { findCodec } from './extractCodec'

export type DiscoveredModel = {
  exportName: string
  tableName: string
  sourceFile: string
  schemas: ZodvexModelMeta['schemas']
  /** @internal For slim models — used to reconstruct schemas at codegen time. */
  _modelRef?: unknown
  /** @internal Live model object — used by codegen to build Convex TableDefinitions. */
  _liveModel?: unknown
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

/**
 * A codec located at a DATA path within a model's doc schema — the unit the
 * descriptor emitter (`generateModelDescriptors`) consumes. Unlike
 * {@link ModelEmbeddedCodec} (whose accessPath is a schema-STRUCTURE
 * expression and which deliberately skips zx.date), this walk:
 *  - includes zx.date() codecs (descriptors must decode them),
 *  - produces data paths (object keys + '*' for array elements),
 *  - reports unsupported containers (union/record/tuple subtrees holding
 *    codecs) so the emitter can fall back to the full model for that table.
 */
export type ModelCodecPath = {
  /** Object keys from the doc root; '*' = array element. */
  path: (string | '*')[]
  codec: $ZodType
  /** zx.date() (in: number, out: custom) — emitter constructs zx.date() inline. */
  isDate: boolean
  /** The value position is wrapped optional/nullable at its leaf. */
  optional: boolean
  nullable: boolean
}

export type ModelCodecPathsResult =
  | { supported: true; paths: ModelCodecPath[] }
  | { supported: false; reason: string }

/**
 * Walks a model's DOC schema for codec data paths. Returns
 * `supported: false` when a codec sits inside a container the descriptor
 * format can't address path-wise (union branch, record value, tuple slot) —
 * the caller falls back to importing the full model for that table.
 */
export function walkModelCodecPaths(doc: $ZodType): ModelCodecPathsResult {
  const paths: ModelCodecPath[] = []
  const visited = new Set<$ZodType>()

  function subtreeHasCodec(schema: $ZodType, seen: Set<$ZodType>): boolean {
    if (seen.has(schema)) return false
    seen.add(schema)
    if (schema instanceof $ZodCodec) return true
    const def = (schema as any)._zod?.def
    if (!def) return false
    for (const value of Object.values(def)) {
      if (value instanceof $ZodType && subtreeHasCodec(value, seen)) return true
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item instanceof $ZodType && subtreeHasCodec(item, seen)) return true
        }
      } else if (value && typeof value === 'object') {
        for (const item of Object.values(value)) {
          if (item instanceof $ZodType && subtreeHasCodec(item, seen)) return true
        }
      }
    }
    return false
  }

  function walk(
    schema: $ZodType,
    path: (string | '*')[],
    optional: boolean,
    nullable: boolean
  ): string | null {
    if (visited.has(schema)) return null
    visited.add(schema)

    if (schema instanceof $ZodCodec) {
      const isDate =
        (schema as any)._zod.def.in instanceof $ZodNumber &&
        (schema as any)._zod.def.out instanceof $ZodCustom
      paths.push({ path, codec: schema, isDate, optional, nullable })
      return null
    }
    if (schema instanceof $ZodOptional) {
      return walk((schema as any)._zod.def.innerType, path, true, nullable)
    }
    if (schema instanceof $ZodNullable) {
      return walk((schema as any)._zod.def.innerType, path, optional, true)
    }
    if (schema instanceof $ZodObject) {
      const shape = (schema as any)._zod.def.shape as Record<string, $ZodType>
      for (const [key, field] of Object.entries(shape ?? {})) {
        const err = walk(field, [...path, key], false, false)
        if (err) return err
      }
      return null
    }
    if (schema instanceof $ZodArray) {
      return walk((schema as any)._zod.def.element, [...path, '*'], false, false)
    }
    // Containers the descriptor format can't address: only a problem if a
    // codec actually lives inside.
    if (
      schema instanceof $ZodUnion ||
      schema instanceof $ZodRecord ||
      schema instanceof $ZodTuple
    ) {
      if (subtreeHasCodec(schema, new Set())) {
        const kind =
          schema instanceof $ZodUnion ? 'union' : schema instanceof $ZodRecord ? 'record' : 'tuple'
        return `codec inside ${kind} at .${path.join('.')}`
      }
      return null
    }
    // Other wrappers (default/readonly/pipe-like): descend any schema-valued
    // def slots conservatively at the same path.
    const def = (schema as any)._zod?.def
    if (def?.innerType instanceof $ZodType) {
      return walk(def.innerType, path, optional, nullable)
    }
    if (subtreeHasCodec(schema, new Set())) {
      return `codec inside unsupported node at .${path.join('.')}`
    }
    return null
  }

  const err = walk(doc, [], false, false)
  if (err) return { supported: false, reason: err }
  return { supported: true, paths }
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
 * Reconstructs the schemas bundle for a slim model by deriving doc, insert,
 * update, docArray, and paginatedDoc from the model's fields and schema.
 */
function reconstructSchemas(model?: {
  name: string
  fields: Record<string, $ZodType>
  schema?: unknown
  doc?: unknown
}): ZodvexModelMeta['schemas'] | null {
  if (!model) return null
  const modelInput = model as any
  const docSchema = modelInput.doc instanceof $ZodType ? modelInput.doc : zx.doc(modelInput)
  const baseSchema =
    modelInput.schema instanceof $ZodType ? modelInput.schema : z.object(model.fields)
  return {
    doc: docSchema,
    insert: baseSchema,
    update: createSchemaUpdateSchema(model.name, baseSchema),
    docArray: z.array(docSchema),
    paginatedDoc: zx.paginationResult(docSchema)
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
  schemas: ZodvexModelMeta['schemas'],
  model?: { name: string; fields: Record<string, $ZodType>; schema?: unknown; doc?: unknown }
): ModelEmbeddedCodec[] {
  // Reconstruct schemas from model if meta.schemas is absent (slim model)
  const effectiveSchemas = schemas ?? reconstructSchemas(model)
  const found: ModelEmbeddedCodec[] = []
  if (!effectiveSchemas) return found
  const visited = new Set<$ZodType>()
  const seenCodecs = new Set<$ZodType>()

  for (const schemaKey of ['doc', 'insert', 'update'] as const) {
    const schema = effectiveSchemas[schemaKey]
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
 *
 * Each file is imported once per process. Watch mode (`zodvex dev`) does NOT
 * re-import in-process between edits — query-string cache-busting is a
 * Node-only trick that Bun's loader ignores (Bun caches ESM modules by
 * resolved path), so the watcher spawns a fresh `generate` subprocess per
 * change instead. See `regenerate()` in cli/commands.ts.
 *
 * @param convexDir Absolute path to the convex directory to scan.
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
      'crons.js',
      // schema.{ts,js} never exports queries/mutations/codecs — and under
      // the lazy-tables shape it imports from `_zodvex/tables`, which is
      // generated DURING this same codegen pass. Importing it during
      // discovery would create an ordering loop on first run; ignore it.
      'schema.ts',
      'schema.js'
    ]
  }).sort()

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
                  schemas: meta.schemas,
                  _modelRef: meta.schemas ? undefined : value,
                  _liveModel: value
                }
              }
              // If existing is direct and new is barrel, skip
            } else {
              models.push({
                exportName,
                tableName: meta.tableName,
                sourceFile: file,
                schemas: meta.schemas,
                _modelRef: meta.schemas ? undefined : value,
                _liveModel: value
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
      const found = walkModelCodecs(
        model.exportName,
        model.sourceFile,
        model.schemas,
        model._modelRef as any
      )
      modelCodecs.push(...found)
    }

    const functionCodecs = walkFunctionCodecs(functions)

    return { models, functions, codecs, modelCodecs, functionCodecs }
  } finally {
    cleanupStubs()
  }
}
