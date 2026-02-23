import { defineSchema, defineTable, type TableDefinition } from 'convex/server'
import type { ObjectType, VObject } from 'convex/values'
import type { z } from 'zod'
import { zodToConvexFields, type ConvexValidatorFromZodFieldsAuto } from './mapping'
import type { SearchIndexConfig, VectorIndexConfig } from './model'

/**
 * The set of Zod schemas produced by zodTable() or defineZodModel() for a single table.
 * Carries doc (full with system fields), insert (user fields only),
 * update (partial user fields + _id), base, and docArray.
 */
export type ZodTableSchemas = {
  doc: z.ZodTypeAny
  docArray: z.ZodTypeAny
  base: z.ZodTypeAny
  insert: z.ZodTypeAny
  update: z.ZodTypeAny
}

/**
 * Maps table names to their full schema set.
 * Used by CodecDatabaseReader/Writer to look up decode/encode schemas.
 */
export type ZodTableMap = Record<string, ZodTableSchemas>

// Accept any zodTable() result shape — both object-shape and union overloads
type ZodTableEntry = {
  table: any
  schema: ZodTableSchemas
}

// Accept defineZodModel() results
type ZodModelEntry = {
  name: string
  fields: z.ZodRawShape
  schema: {
    doc: z.ZodTypeAny
    base: z.ZodTypeAny
    insert: z.ZodTypeAny
    update: z.ZodTypeAny
    docArray: z.ZodTypeAny
  }
  indexes: Record<string, readonly string[]>
  searchIndexes: Record<string, SearchIndexConfig>
  vectorIndexes: Record<string, VectorIndexConfig>
}

type ZodSchemaEntry = ZodTableEntry | ZodModelEntry

function isZodModelEntry(entry: ZodSchemaEntry): entry is ZodModelEntry {
  return 'fields' in entry && 'indexes' in entry && !('table' in entry)
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
 * - defineZodModel entries: compute from fields + indexes.
 *   This mirrors what tableFromModel() + defineTable() do at runtime:
 *   fields → zodToConvexFields → ConvexValidatorFromZodFieldsAuto → VObject.
 *   Indexes are converted from readonly tuples to mutable (Convex's format).
 */
type ConvexTableFor<E> =
  // zodTable entry — extract .table with full VObject type
  E extends { table: infer T extends TableDefinition }
    ? T
    : // model entry — compute from fields + indexes
      E extends {
          fields: infer F extends Record<string, z.ZodTypeAny>
          indexes: infer I extends Record<string, readonly string[]>
        }
      ? TableDefinition<
          VObject<
            ObjectType<ConvexValidatorFromZodFieldsAuto<F>>,
            ConvexValidatorFromZodFieldsAuto<F>
          >,
          // Convert readonly index tuples to mutable (Convex's format)
          { [K in keyof I]: [...I[K]] }
        >
      : TableDefinition

/**
 * Map all entries to their Convex TableDefinition types.
 * This is the type-level equivalent of the runtime loop that builds convexTables.
 */
type ConvexTablesFrom<T extends Record<string, ZodSchemaEntry>> = {
  [K in keyof T & string]: ConvexTableFor<T[K]>
}

// ============================================================================
// Runtime helpers
// ============================================================================

/**
 * Creates a Convex table definition from a ZodModel's fields and index metadata.
 */
function tableFromModel(model: ZodModelEntry) {
  const convexFields = zodToConvexFields(model.fields)
  let table = defineTable(convexFields)

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
      convexTables[name] = tableFromModel(entry)
      zodTableMap[name] = {
        doc: entry.schema.doc,
        docArray: entry.schema.docArray,
        base: entry.schema.base,
        insert: entry.schema.insert,
        update: entry.schema.update
      }
    } else {
      convexTables[name] = entry.table
      zodTableMap[name] = entry.schema
    }
  }

  // Runtime builds convexTables dynamically (loop erases types).
  // ConvexTablesFrom<T> restores the full TableDefinition types that
  // defineSchema needs to produce a properly-typed DataModel.
  const convexSchema = defineSchema(convexTables as ConvexTablesFrom<T>)

  return Object.assign(convexSchema, { __zodTableMap: zodTableMap })
}
