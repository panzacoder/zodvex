import { z } from 'zod'
import { stripUndefined } from '../utils'
import { decodeDoc, encodeDoc } from './primitives'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal shape of a zodTable entry — we need `name`, `schema.doc`, and `schema.base`. */
type ZodTableEntry = {
  name: string
  schema: {
    doc: z.ZodTypeAny
    base: z.ZodTypeAny
  }
}

/** Map of table name -> zodTable entry. */
type ZodTableMap = Record<string, ZodTableEntry>

/**
 * Minimal interface for a Convex query chain (the object returned by db.query()).
 * We only require the methods we delegate to and the terminals we intercept.
 */
interface ConvexQueryChain {
  withIndex(name: string, fn?: any): ConvexQueryChain
  filter(fn: any): ConvexQueryChain
  order(order: string): ConvexQueryChain
  collect(): Promise<any[]>
  first(): Promise<any | null>
  unique(): Promise<any | null>
  take(n: number): Promise<any[]>
}

/** Minimal interface for a Convex database reader. */
interface ConvexDbReader {
  get(id: any): Promise<any | null>
  query(table: string): ConvexQueryChain
  system?: any
}

/** Minimal interface for a Convex database writer (extends reader). */
interface ConvexDbWriter extends ConvexDbReader {
  insert(table: string, doc: any): Promise<any>
  patch(id: any, patch: any): Promise<void>
  delete(id: any): Promise<void>
}

// ---------------------------------------------------------------------------
// Decode pipeline
// ---------------------------------------------------------------------------

/** Wire-format document (as stored in / returned from Convex). */
export type WireDoc = Record<string, unknown>

/** Runtime-format document (after codec decode, e.g. Dates instead of timestamps). */
export type RuntimeDoc = Record<string, unknown>

/** Decode a single document using the schema's codec. */
function decodeOne(raw: WireDoc, schema: z.ZodTypeAny): RuntimeDoc {
  return decodeDoc(schema, raw) as RuntimeDoc
}

/** Decode multiple documents using the schema's codec. */
function decodeMany(rawDocs: WireDoc[], schema: z.ZodTypeAny): RuntimeDoc[] {
  return rawDocs.map(doc => decodeDoc(schema, doc) as RuntimeDoc)
}

// ---------------------------------------------------------------------------
// Table detection for db.get()
// ---------------------------------------------------------------------------

/**
 * Try each zodTable's doc schema with safeParse to find the matching table.
 * Returns the schema on first successful parse, or undefined.
 */
function findTableSchema(raw: WireDoc, zodTables: ZodTableMap): z.ZodTypeAny | undefined {
  for (const entry of Object.values(zodTables)) {
    const result = entry.schema.doc.safeParse(raw)
    if (result.success) {
      return entry.schema.doc
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// ZodQueryChain
// ---------------------------------------------------------------------------

/**
 * Wraps a Convex query chain, delegating query-building methods to the inner
 * chain and intercepting terminal methods to apply codec decoding.
 */
class ZodQueryChain {
  constructor(
    private inner: ConvexQueryChain,
    private schema: z.ZodTypeAny
  ) {}

  withIndex(name: string, fn?: any): ZodQueryChain {
    return new ZodQueryChain(this.inner.withIndex(name, fn), this.schema)
  }

  filter(fn: any): ZodQueryChain {
    return new ZodQueryChain(this.inner.filter(fn), this.schema)
  }

  order(order: string): ZodQueryChain {
    return new ZodQueryChain(this.inner.order(order), this.schema)
  }

  async collect(): Promise<RuntimeDoc[]> {
    const rawDocs = await this.inner.collect()
    return decodeMany(rawDocs, this.schema)
  }

  async first(): Promise<RuntimeDoc | null> {
    const raw = await this.inner.first()
    if (raw === null) return null
    return decodeOne(raw, this.schema)
  }

  async unique(): Promise<RuntimeDoc | null> {
    const raw = await this.inner.unique()
    if (raw === null) return null
    return decodeOne(raw, this.schema)
  }

  async take(n: number): Promise<RuntimeDoc[]> {
    const rawDocs = await this.inner.take(n)
    return decodeMany(rawDocs, this.schema)
  }
}

// ---------------------------------------------------------------------------
// createZodDbReader
// ---------------------------------------------------------------------------

/**
 * Creates a codec-aware database reader that wraps a Convex db reader.
 *
 * Intercepts read operations and applies codec decoding (wire -> runtime,
 * e.g. timestamp -> Date) using zodTable schemas.
 *
 * @param db - A Convex database reader (ctx.db)
 * @param zodTables - Map of table name -> zodTable entry
 * @returns A wrapped database reader with codec-aware read operations
 *
 * @example
 * ```ts
 * const zodDb = createZodDbReader(ctx.db, { events: Events, users: Users })
 * const event = await zodDb.get(eventId) // event.startDate is a Date
 * const users = await zodDb.query('users').collect() // decoded
 * ```
 */
export function createZodDbReader(db: ConvexDbReader, zodTables: ZodTableMap) {
  return {
    async get(id: any): Promise<any | null> {
      const raw = await db.get(id)
      if (raw === null) return null

      const schema = findTableSchema(raw as WireDoc, zodTables)
      if (!schema) return raw

      return decodeOne(raw as WireDoc, schema)
    },

    query(table: string): ZodQueryChain {
      const entry = zodTables[table]
      if (!entry) {
        throw new Error(
          `Unknown table "${table}" — not found in zodTables. ` +
            `Available tables: ${Object.keys(zodTables).join(', ')}`
        )
      }

      const innerChain = db.query(table)
      return new ZodQueryChain(innerChain, entry.schema.doc)
    },

    get system() {
      return (db as any).system
    }
  }
}

// ---------------------------------------------------------------------------
// Encode pipeline
// ---------------------------------------------------------------------------

/**
 * Encode a full document using the base schema (for insert).
 * Applies z.encode on the entire schema, then strips undefined.
 */
function encodeFullDoc(baseSchema: z.ZodTypeAny, doc: RuntimeDoc): WireDoc {
  return encodeDoc(baseSchema, doc) as WireDoc
}

/**
 * Encode a partial document field-by-field (for patch).
 * Only encodes fields that are present in the patch, using each field's
 * individual schema from the base schema's shape.
 */
function encodePatchFields(baseSchema: z.ZodTypeAny, patch: RuntimeDoc): WireDoc {
  // If the base schema isn't a ZodObject, fall back to encoding as-is
  if (!(baseSchema instanceof z.ZodObject)) {
    return stripUndefined(patch) as WireDoc
  }

  const shape = baseSchema.shape as Record<string, z.ZodTypeAny>
  const encoded: WireDoc = {}

  for (const [key, value] of Object.entries(patch)) {
    const fieldSchema = shape[key]
    if (fieldSchema) {
      // Encode this field using its individual schema
      encoded[key] = z.encode(fieldSchema, value)
    } else {
      // Unknown field — pass through as-is (e.g., system fields)
      encoded[key] = value
    }
  }

  return stripUndefined(encoded) as WireDoc
}

// ---------------------------------------------------------------------------
// createZodDbWriter
// ---------------------------------------------------------------------------

/**
 * Creates a codec-aware database writer that wraps a Convex db writer.
 *
 * Extends the reader with insert/patch/delete that encode runtime types
 * back to wire format (e.g. Date -> timestamp) using zodTable schemas.
 *
 * @param db - A Convex database writer (ctx.db)
 * @param zodTables - Map of table name -> zodTable entry
 * @returns A wrapped database writer with codec-aware read and write operations
 *
 * @example
 * ```ts
 * const zodDb = createZodDbWriter(ctx.db, { events: Events, users: Users })
 * await zodDb.insert('events', { title: 'Meeting', startDate: new Date() })
 * await zodDb.patch(eventId, { startDate: new Date() })
 * await zodDb.delete(eventId)
 * const event = await zodDb.get(eventId) // event.startDate is a Date
 * ```
 */
export function createZodDbWriter(db: ConvexDbWriter, zodTables: ZodTableMap) {
  const reader = createZodDbReader(db, zodTables)

  return {
    get: reader.get,
    query: reader.query.bind(reader),
    get system() {
      return reader.system
    },

    async insert(table: string, doc: RuntimeDoc): Promise<any> {
      const entry = zodTables[table]
      if (!entry) {
        throw new Error(
          `Unknown table "${table}" — not found in zodTables. ` +
            `Available tables: ${Object.keys(zodTables).join(', ')}`
        )
      }

      const wire = encodeFullDoc(entry.schema.base, doc)
      return db.insert(table, wire)
    },

    async patch(id: any, patch: RuntimeDoc): Promise<void> {
      // Determine table by looking up the ID prefix in zodTables
      const tableName = extractTableName(id)
      const entry = tableName ? zodTables[tableName] : undefined

      let wire: WireDoc
      if (entry) {
        wire = encodePatchFields(entry.schema.base, patch)
      } else {
        wire = stripUndefined(patch) as WireDoc
      }

      await db.patch(id, wire)
    },

    async delete(id: any): Promise<void> {
      await db.delete(id)
    }
  }
}

/**
 * Extract table name from a Convex document ID.
 * Convex IDs follow the pattern "tableName:id" in development.
 * Returns undefined if the pattern doesn't match.
 */
function extractTableName(id: any): string | undefined {
  if (typeof id !== 'string') return undefined
  const colonIndex = id.indexOf(':')
  if (colonIndex === -1) return undefined
  return id.substring(0, colonIndex)
}
