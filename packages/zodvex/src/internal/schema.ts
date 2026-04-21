import {
  type DataModelFromSchemaDefinition,
  defineSchema,
  defineTable,
  type NamedTableInfo,
  type TableDefinition,
  type TableNamesInDataModel
} from 'convex/server'
import type { ObjectType, VObject } from 'convex/values'
import type { ZodvexFilterBuilder } from './db'
import {
  type ConvexValidatorFromZod,
  type ConvexValidatorFromZodFieldsAuto,
  zodToConvex,
  zodToConvexFields
} from './mapping'
import { readMeta, type ZodvexModelMeta } from './meta'
import type { AnyZodModel, AnyZodModelBase, SearchIndexConfig, VectorIndexConfig } from './model'
import type {
  $ZodDiscriminatedUnion,
  $ZodShape,
  $ZodType,
  $ZodUnion,
  output as zoutput
} from './zod-core'
import { zx } from './zx'

/**
 * The runtime schema slice the DB wrapper needs for a single table:
 *   - `doc` — decode shape for reads (full doc with system fields)
 *   - `insert` — encode shape for writes (user fields only)
 *
 * Other derived schemas (`update`, `docArray`, `paginatedDoc`, `base`) are not
 * retained here — they're constructed on demand via `zx.*` at use sites, with
 * per-model WeakMap caches deduplicating across call sites. This keeps
 * `zodTableMap` minimal for the Convex 64MB isolate budget.
 */
export type ZodTableSchemas = {
  doc: $ZodType
  insert: $ZodType
}

/**
 * Maps table names to their full schema set.
 * Used by ZodvexDatabaseReader/Writer to look up decode/encode schemas.
 */
export type ZodTableMap = Record<string, ZodTableSchemas>

// Accept any zodTable() result shape — both object-shape and union overloads
type ZodTableEntry = {
  table: any
  schema: ZodTableSchemas
}

// Accept defineZodModel() results — constrained against the base type
// so both full models (with schema bundle) and slim models work.
export type ZodModelEntry = AnyZodModelBase

type ZodSchemaEntry = ZodTableEntry | ZodModelEntry

function isZodModelEntry(entry: ZodSchemaEntry): entry is ZodModelEntry {
  return readMeta(entry)?.type === 'model'
}

function getZodModelMeta(model: ZodModelEntry): ZodvexModelMeta {
  const meta = readMeta(model)
  if (!meta || meta.type !== 'model') {
    throw new Error(`Model '${model.name}' is missing zodvex model metadata.`)
  }
  return meta
}

// ============================================================================
// Type-level table definition computation
// ============================================================================

/**
 * Compute the Convex TableDefinition type for a single schema entry.
 *
 * - zodTable entries: extract the already-typed .table property.
 *   At the call site, T[K] preserves the specific zodTable return type
 *   (not the widened ZodTableEntry), so `infer` captures the full
 *   TableDefinition<VObject<...>> type.
 *
 * - defineZodModel entries: compute from fields/schema + indexes.
 *   This mirrors what tableFromModel() + defineTable() do at runtime.
 *   For union models (schema.base extends $ZodUnion | $ZodDiscriminatedUnion),
 *   uses ConvexValidatorFromZod<Base> (produces VUnion) instead of
 *   ConvexValidatorFromZodFieldsAuto<F> (which would see empty fields).
 *   Indexes are converted from readonly tuples to mutable (Convex's format).
 */
type ConvexTableFor<E> =
  // zodTable entry — extract .table with full VObject type
  E extends { table: infer T extends TableDefinition }
    ? T
    : // Full model entry — schema is nested bundle with .base
      E extends {
          fields: infer F extends Record<string, $ZodType>
          schema: { base: infer Base extends $ZodType }
          indexes: infer I extends Record<string, readonly string[]>
          searchIndexes: infer SI extends Record<string, SearchIndexConfig>
          vectorIndexes: infer VI extends Record<string, VectorIndexConfig>
        }
      ? Base extends $ZodUnion<any> | $ZodDiscriminatedUnion<any, any>
        ? TableDefinition<
            ConvexValidatorFromZod<Base, 'required'>,
            { [K in keyof I]: [...I[K]] },
            { [K in keyof SI]: { searchField: string; filterFields: string } },
            { [K in keyof VI]: { vectorField: string; dimensions: number; filterFields: string } }
          >
        : TableDefinition<
            VObject<
              ObjectType<ConvexValidatorFromZodFieldsAuto<F>>,
              ConvexValidatorFromZodFieldsAuto<F>
            >,
            { [K in keyof I]: [...I[K]] },
            { [K in keyof SI]: { searchField: string; filterFields: string } },
            { [K in keyof VI]: { vectorField: string; dimensions: number; filterFields: string } }
          >
      : // Slim union model entry — `schema` is the bare $ZodType (user-supplied union)
        E extends {
            fields: infer F extends Record<string, $ZodType>
            schema: infer Base extends $ZodType
            indexes: infer I extends Record<string, readonly string[]>
            searchIndexes: infer SI extends Record<string, SearchIndexConfig>
            vectorIndexes: infer VI extends Record<string, VectorIndexConfig>
          }
        ? Base extends $ZodUnion<any> | $ZodDiscriminatedUnion<any, any>
          ? TableDefinition<
              ConvexValidatorFromZod<Base, 'required'>,
              { [K in keyof I]: [...I[K]] },
              { [K in keyof SI]: { searchField: string; filterFields: string } },
              { [K in keyof VI]: { vectorField: string; dimensions: number; filterFields: string } }
            >
          : TableDefinition<
              VObject<
                ObjectType<ConvexValidatorFromZodFieldsAuto<F>>,
                ConvexValidatorFromZodFieldsAuto<F>
              >,
              { [K in keyof I]: [...I[K]] },
              { [K in keyof SI]: { searchField: string; filterFields: string } },
              { [K in keyof VI]: { vectorField: string; dimensions: number; filterFields: string } }
            >
        : // Slim object model entry — no `schema` property; derive from fields.
          E extends {
              fields: infer F extends Record<string, $ZodType>
              indexes: infer I extends Record<string, readonly string[]>
              searchIndexes: infer SI extends Record<string, SearchIndexConfig>
              vectorIndexes: infer VI extends Record<string, VectorIndexConfig>
            }
          ? TableDefinition<
              VObject<
                ObjectType<ConvexValidatorFromZodFieldsAuto<F>>,
                ConvexValidatorFromZodFieldsAuto<F>
              >,
              { [K in keyof I]: [...I[K]] },
              { [K in keyof SI]: { searchField: string; filterFields: string } },
              { [K in keyof VI]: { vectorField: string; dimensions: number; filterFields: string } }
            >
          : TableDefinition

/**
 * Map all entries to their Convex TableDefinition types.
 * This is the type-level equivalent of the runtime loop that builds convexTables.
 */
type ConvexTablesFrom<T extends Record<string, ZodSchemaEntry>> = {
  [K in keyof T & string]: ConvexTableFor<T[K]>
}

/**
 * Computes decoded (runtime) document types for each table from the schema entry types.
 * Uses z.output<> on each table's doc schema, which resolves codec transforms
 * (e.g., zx.date() wire number → runtime Date).
 *
 * This is a phantom type — it exists only for TypeScript inference, never accessed at runtime.
 * Handles both full models (schema bundle with .doc) and slim models (no schema bundle)
 * by falling through to `any` when the schema shape doesn't match.
 */
export type DecodedDocFor<T extends Record<string, ZodSchemaEntry>> = {
  [K in keyof T & string]: T[K] extends { schema: { doc: infer D extends $ZodType } }
    ? zoutput<D>
    : T[K] extends { doc: infer D extends $ZodType }
      ? zoutput<D>
      : any
}

// ============================================================================
// Runtime helpers
// ============================================================================

/**
 * Creates a Convex table definition from a ZodModel's fields and index metadata.
 */
function tableFromModel(model: ZodModelEntry) {
  const meta = getZodModelMeta(model)
  const usesBaseSchema =
    meta.definitionSource === 'schema' ||
    (meta.definitionSource == null && Object.keys(model.fields).length === 0)

  let table = usesBaseSchema
    ? defineTable(zodToConvex(zx.base(model as any)) as any)
    : defineTable(zodToConvexFields(model.fields))

  for (const [indexName, indexFields] of Object.entries(model.indexes)) {
    // defineZodModel appends _creationTime to stored index fields,
    // but Convex adds it automatically — strip it
    const userFields = indexFields.filter(f => f !== '_creationTime')
    table = table.index(indexName, userFields as any)
  }

  for (const [indexName, config] of Object.entries(model.searchIndexes)) {
    table = table.searchIndex(indexName, config as any)
  }

  for (const [indexName, config] of Object.entries(model.vectorIndexes)) {
    table = table.vectorIndex(indexName, config as any)
  }

  return table
}

// ============================================================================
// defineZodSchema
// ============================================================================

/**
 * Wraps Convex's defineSchema() and captures zodTable/model references.
 * The returned object is a valid Convex schema AND carries __zodTableMap
 * for use by createZodDbReader/createZodDbWriter.
 *
 * Accepts either zodTable() results or defineZodModel() results.
 * When given a model, creates the Convex table definition from the
 * model's fields and applies its index metadata.
 *
 * Type preservation: the ConvexTablesFrom<T> mapped type computes the
 * full TableDefinition<VObject<...>> for each entry, so defineSchema
 * receives specific document types and index metadata. This ensures
 * DataModelFromSchemaDefinition produces a DataModel with typed documents,
 * field paths, and index constraints — required for ctx.db and withIndex
 * type safety.
 *
 * @example With defineZodModel
 * ```typescript
 * // convex/schema.ts
 * import { UserModel } from './models/user'
 * import { TaskModel } from './models/task'
 *
 * export default defineZodSchema({
 *   users: UserModel,
 *   tasks: TaskModel,
 * })
 * ```
 *
 * @example With zodTable (legacy)
 * ```typescript
 * export default defineZodSchema({
 *   users: Users,  // zodTable() result
 *   posts: Posts,
 * })
 * ```
 */
export function defineZodSchema<T extends Record<string, ZodSchemaEntry>>(tables: T) {
  const convexTables: Record<string, any> = {}
  const zodTableMap: ZodTableMap = {}

  for (const [name, entry] of Object.entries(tables)) {
    if (isZodModelEntry(entry)) {
      if (entry.name !== name) {
        throw new Error(
          `Model name '${entry.name}' does not match key '${name}'. ` +
            `The model name must match the key in the schema definition.`
        )
      }
      convexTables[name] = tableFromModel(entry)

      // Only `doc` (read decode) and `insert` (write encode) are consumed at
      // runtime by the DB wrapper. Full models already carry `meta.schemas.doc`
      // and `meta.schemas.insert` — alias them (no allocation). Slim models go
      // through cached zx helpers, so `doc`/`base` allocate at most once each.
      const meta = getZodModelMeta(entry)
      if (meta.schemas) {
        zodTableMap[name] = {
          doc: meta.schemas.doc,
          insert: meta.schemas.insert
        }
      } else {
        zodTableMap[name] = {
          doc: zx.doc(entry),
          insert: zx.base(entry)
        }
      }
    } else {
      convexTables[name] = entry.table
      // zodTable produces a 6-schema bundle; we only need doc + insert.
      zodTableMap[name] = {
        doc: entry.schema.doc,
        insert: entry.schema.insert
      }
    }
  }

  // Runtime builds convexTables dynamically (loop erases types).
  // ConvexTablesFrom<T> restores the full TableDefinition types that
  // defineSchema needs to produce a properly-typed DataModel.
  const convexSchema = defineSchema(convexTables as ConvexTablesFrom<T>)

  const result = Object.assign(convexSchema, { __zodTableMap: zodTableMap })
  return result as typeof result & { __decodedDocs: DecodedDocFor<T> }
}

// ============================================================================
// Schema-derived helper types
// ============================================================================

/** Extract the DataModel from a defineZodSchema result */
export type InferDataModel<Schema extends ReturnType<typeof defineZodSchema>> =
  DataModelFromSchemaDefinition<Schema>

/** Extract TableInfo for a specific table */
export type InferTableInfo<
  Schema extends ReturnType<typeof defineZodSchema>,
  TableName extends TableNamesInDataModel<InferDataModel<Schema>>
> = NamedTableInfo<InferDataModel<Schema>, TableName>

/** Extract the decoded document type for a specific table */
export type InferDecodedDoc<
  Schema extends ReturnType<typeof defineZodSchema>,
  TableName extends TableNamesInDataModel<InferDataModel<Schema>>
> = Schema extends { __decodedDocs: infer DD }
  ? TableName extends keyof DD
    ? DD[TableName]
    : never
  : never

/** A ZodvexFilterBuilder typed for a specific table */
export type InferFilterBuilder<
  Schema extends ReturnType<typeof defineZodSchema>,
  TableName extends TableNamesInDataModel<InferDataModel<Schema>>
> = ZodvexFilterBuilder<InferTableInfo<Schema, TableName>, InferDecodedDoc<Schema, TableName>>
