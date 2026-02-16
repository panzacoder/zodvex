import type { z } from 'zod'
import type { DatabaseHooks, RuntimeDoc, WireDoc } from './hooks'
import { decodeDoc } from './primitives'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal shape of a zodTable entry — we only need `name` and `schema.doc`. */
type ZodTableEntry = {
  name: string
  schema: {
    doc: z.ZodTypeAny
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

// ---------------------------------------------------------------------------
// Decode pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full decode pipeline for a single document:
 * 1. decode.before.one hook (wire format) -> can return null to filter
 * 2. codec decode via schema.doc.parse (wire -> runtime)
 * 3. decode.after.one hook (runtime format) -> can return null or transform
 */
async function decodeOne(
  raw: WireDoc,
  schema: z.ZodTypeAny,
  hooks: DatabaseHooks | undefined,
  ctx: unknown
): Promise<RuntimeDoc | null> {
  // Step 1: decode.before.one
  let wire: WireDoc | null = raw
  if (hooks?.decode?.before?.one) {
    wire = await hooks.decode.before.one(ctx, wire)
    if (wire === null) return null
  }

  // Step 2: codec decode
  let runtime: RuntimeDoc = decodeDoc(schema, wire)

  // Step 3: decode.after.one
  if (hooks?.decode?.after?.one) {
    const result = await hooks.decode.after.one(ctx, runtime)
    if (result === null) return null
    runtime = result
  }

  return runtime
}

/**
 * Run the full decode pipeline for multiple documents.
 *
 * If decode.before.many is defined, use it (passing a bound `one` as third arg).
 * Otherwise, map decode.before.one over each doc.
 *
 * Similarly for decode.after.many.
 */
async function decodeMany(
  rawDocs: WireDoc[],
  schema: z.ZodTypeAny,
  hooks: DatabaseHooks | undefined,
  ctx: unknown
): Promise<RuntimeDoc[]> {
  // --- Before stage ---
  let wireDocs: WireDoc[]
  const beforeOneHook = hooks?.decode?.before?.one

  if (hooks?.decode?.before?.many) {
    // Bind `one` for the many hook
    const boundOne = async (doc: WireDoc): Promise<WireDoc | null> => {
      if (beforeOneHook) return beforeOneHook(ctx, doc) as Promise<WireDoc | null>
      return doc
    }
    wireDocs = await hooks.decode.before.many(ctx, rawDocs, boundOne)
  } else if (beforeOneHook) {
    // Map one over each doc, filtering nulls
    const results = await Promise.all(rawDocs.map(doc => Promise.resolve(beforeOneHook(ctx, doc))))
    wireDocs = results.filter((d): d is WireDoc => d !== null)
  } else {
    wireDocs = rawDocs
  }

  // --- Codec decode each ---
  let runtimeDocs: RuntimeDoc[] = wireDocs.map(doc => decodeDoc(schema, doc))

  // --- After stage ---
  const afterOneHook = hooks?.decode?.after?.one

  if (hooks?.decode?.after?.many) {
    const boundOne = async (doc: RuntimeDoc): Promise<RuntimeDoc | null> => {
      if (afterOneHook) return afterOneHook(ctx, doc) as Promise<RuntimeDoc | null>
      return doc
    }
    runtimeDocs = await hooks.decode.after.many(ctx, runtimeDocs, boundOne)
  } else if (afterOneHook) {
    const results = await Promise.all(
      runtimeDocs.map(doc => Promise.resolve(afterOneHook(ctx, doc)))
    )
    runtimeDocs = results.filter((d): d is RuntimeDoc => d !== null)
  }

  return runtimeDocs
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
 * chain and intercepting terminal methods to apply the decode pipeline.
 */
class ZodQueryChain {
  constructor(
    private inner: ConvexQueryChain,
    private schema: z.ZodTypeAny,
    private hooks: DatabaseHooks | undefined,
    private ctx: unknown
  ) {}

  /** Delegate: filter by index. */
  withIndex(name: string, fn?: any): ZodQueryChain {
    return new ZodQueryChain(this.inner.withIndex(name, fn), this.schema, this.hooks, this.ctx)
  }

  /** Delegate: filter. */
  filter(fn: any): ZodQueryChain {
    return new ZodQueryChain(this.inner.filter(fn), this.schema, this.hooks, this.ctx)
  }

  /** Delegate: order. */
  order(order: string): ZodQueryChain {
    return new ZodQueryChain(this.inner.order(order), this.schema, this.hooks, this.ctx)
  }

  /** Terminal: collect all results and decode. */
  async collect(): Promise<RuntimeDoc[]> {
    const rawDocs = await this.inner.collect()
    return decodeMany(rawDocs, this.schema, this.hooks, this.ctx)
  }

  /** Terminal: get first result and decode. */
  async first(): Promise<RuntimeDoc | null> {
    const raw = await this.inner.first()
    if (raw === null) return null
    return decodeOne(raw, this.schema, this.hooks, this.ctx)
  }

  /** Terminal: get unique result and decode. */
  async unique(): Promise<RuntimeDoc | null> {
    const raw = await this.inner.unique()
    if (raw === null) return null
    return decodeOne(raw, this.schema, this.hooks, this.ctx)
  }

  /** Terminal: take n results and decode. */
  async take(n: number): Promise<RuntimeDoc[]> {
    const rawDocs = await this.inner.take(n)
    return decodeMany(rawDocs, this.schema, this.hooks, this.ctx)
  }
}

// ---------------------------------------------------------------------------
// createZodDbReader
// ---------------------------------------------------------------------------

/**
 * Creates a codec-aware database reader that wraps a Convex db reader.
 *
 * The wrapper intercepts read operations and applies the decode pipeline:
 * 1. Raw doc from Convex
 * 2. decode.before hooks (wire format, can filter/transform)
 * 3. Codec decode via zodTable schema (wire -> runtime, e.g. timestamp -> Date)
 * 4. decode.after hooks (runtime format, can transform/enrich)
 *
 * @param db - A Convex database reader (ctx.db)
 * @param zodTables - Map of table name -> zodTable entry
 * @param hooks - Optional DatabaseHooks for decode interception
 * @param ctx - Optional context passed to hooks (defaults to empty object)
 * @returns A wrapped database reader with codec-aware read operations
 *
 * @example
 * ```ts
 * const zodDb = createZodDbReader(ctx.db, { events: Events, users: Users })
 * const event = await zodDb.get(eventId) // event.startDate is a Date
 * const users = await zodDb.query('users').collect() // decoded
 * ```
 */
export function createZodDbReader(
  db: ConvexDbReader,
  zodTables: ZodTableMap,
  hooks?: DatabaseHooks,
  ctx?: unknown
) {
  const resolvedCtx = ctx ?? {}

  return {
    /**
     * Get a document by ID and decode it.
     *
     * Determines the table by trying each zodTable's doc schema with safeParse.
     * If no schema matches, returns the raw document as-is.
     */
    async get(id: any): Promise<any | null> {
      const raw = await db.get(id)
      if (raw === null) return null

      // Find matching table schema
      const schema = findTableSchema(raw as WireDoc, zodTables)
      if (!schema) {
        // No matching schema found — return raw doc unmodified
        return raw
      }

      return decodeOne(raw as WireDoc, schema, hooks, resolvedCtx)
    },

    /**
     * Start a query chain for a specific table.
     *
     * Returns a ZodQueryChain that delegates query-building methods to the
     * underlying Convex query chain and intercepts terminal methods to decode.
     */
    query(table: string): ZodQueryChain {
      const entry = zodTables[table]
      if (!entry) {
        throw new Error(
          `Unknown table "${table}" — not found in zodTables. ` +
            `Available tables: ${Object.keys(zodTables).join(', ')}`
        )
      }

      const innerChain = db.query(table)
      return new ZodQueryChain(innerChain, entry.schema.doc, hooks, resolvedCtx)
    },

    /** Passthrough to db.system if available. */
    get system() {
      return (db as any).system
    }
  }
}
