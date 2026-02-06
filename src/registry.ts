import { z } from 'zod'

// ============================================================================
// JSON Schema Override Support
// ============================================================================
// Zod's toJSONSchema doesn't support transforms, brands, and other "unrepresentable"
// types by default. This module provides overrides for zodvex-managed types
// so they can be used with AI SDKs and other JSON Schema-based tools.

/**
 * Checks if a schema is a zid (Convex ID) schema by looking at its description.
 * zid schemas are marked with "convexId:{tableName}" in their description.
 */
export function isZidSchema(schema: z.ZodTypeAny): boolean {
  const description = schema.description
  return typeof description === 'string' && description.startsWith('convexId:')
}

/**
 * Extracts the table name from a zid schema's description.
 * Returns undefined if not a zid schema.
 */
export function getZidTableName(schema: z.ZodTypeAny): string | undefined {
  const description = schema.description
  if (typeof description === 'string' && description.startsWith('convexId:')) {
    return description.slice('convexId:'.length)
  }
  return undefined
}

/**
 * Context object passed to the JSON Schema override function.
 * Uses 'any' types for compatibility with Zod's internal types.
 */
export interface JSONSchemaOverrideContext {
  zodSchema: any // Zod's internal $ZodTypes
  jsonSchema: any // Zod's JSONSchema.BaseSchema
}

/**
 * Override function for z.toJSONSchema that handles zodvex-managed types.
 *
 * Handles:
 * - zx.id() schemas: Converts to { type: "string" } with convexId format
 * - zx.date(): Converts to { type: "string", format: "date-time" }
 *
 * @example
 * ```ts
 * import { z } from 'zod'
 * import { zx, zodvexJSONSchemaOverride } from 'zodvex'
 *
 * const schema = z.object({
 *   userId: zx.id('users'),
 *   name: z.string()
 * })
 *
 * const jsonSchema = z.toJSONSchema(schema, {
 *   unrepresentable: 'any',
 *   override: zodvexJSONSchemaOverride
 * })
 * // => { type: "object", properties: { userId: { type: "string" }, name: { type: "string" } } }
 * ```
 */
export function zodvexJSONSchemaOverride(ctx: JSONSchemaOverrideContext): void {
  const { zodSchema, jsonSchema } = ctx

  // Handle zid schemas (transforms with convexId description)
  if (isZidSchema(zodSchema)) {
    const tableName = getZidTableName(zodSchema)
    // Set our properties - don't clear existing ones set by user overrides
    // When unrepresentable: 'any', Zod already gives us {} so no clearing needed
    jsonSchema.type = 'string'
    if (tableName) {
      jsonSchema.format = `convex-id:${tableName}`
    }
    // Preserve the description from .describe() - this is what the LLM sees
    if (zodSchema.description) {
      jsonSchema.description = zodSchema.description
    }
    return
  }

  // Handle z.date() - convert to ISO 8601 string format
  // Zod v4 passes real schema instances here (ZodDate has `type === 'date'`).
  if (zodSchema instanceof z.ZodDate || (zodSchema as any).type === 'date') {
    jsonSchema.type = 'string'
    jsonSchema.format = 'date-time'
    return
  }
}

/**
 * Composes multiple JSON Schema override functions into one.
 * Overrides run in order - first override runs first.
 *
 * @example
 * ```ts
 * import { composeOverrides, zodvexJSONSchemaOverride } from 'zodvex'
 *
 * const myOverride = (ctx) => {
 *   if (ctx.zodSchema.description?.startsWith('myType:')) {
 *     ctx.jsonSchema.type = 'string'
 *     ctx.jsonSchema.format = 'my-format'
 *   }
 * }
 *
 * // User's override runs first, then zodvex's
 * z.toJSONSchema(schema, {
 *   unrepresentable: 'any',
 *   override: composeOverrides(myOverride, zodvexJSONSchemaOverride)
 * })
 * ```
 */
export function composeOverrides(
  ...overrides: Array<((ctx: JSONSchemaOverrideContext) => void) | undefined>
): (ctx: JSONSchemaOverrideContext) => void {
  return (ctx: JSONSchemaOverrideContext) => {
    for (const override of overrides) {
      override?.(ctx)
    }
  }
}

/**
 * Options for toJSONSchema, matching Zod's interface.
 */
export interface ToJSONSchemaOptions {
  target?: 'draft-4' | 'draft-7' | 'draft-2020-12' | 'openapi-3.0'
  unrepresentable?: 'throw' | 'any'
  cycles?: 'ref' | 'throw'
  reused?: 'ref' | 'inline'
  io?: 'input' | 'output'
  override?: (ctx: JSONSchemaOverrideContext) => void
}

/**
 * Converts a Zod schema to JSON Schema with zodvex-aware overrides.
 *
 * This is a convenience wrapper around z.toJSONSchema that automatically
 * handles zodvex-managed types like zx.id() and zx.date().
 *
 * @example
 * ```ts
 * import { zx, toJSONSchema } from 'zodvex'
 *
 * const schema = z.object({
 *   userId: zx.id('users'),
 *   createdAt: zx.date(),
 *   name: z.string()
 * })
 *
 * const jsonSchema = toJSONSchema(schema)
 * // Works with AI SDK's generateObject, etc.
 * ```
 */
export function toJSONSchema<T extends z.ZodTypeAny>(
  schema: T,
  options?: ToJSONSchemaOptions
): Record<string, any> {
  const userOverride = options?.override

  return z.toJSONSchema(schema, {
    ...options,
    // Default to 'any' so transforms don't throw
    unrepresentable: options?.unrepresentable ?? 'any',
    // Chain our override with user's override
    override: ctx => {
      zodvexJSONSchemaOverride(ctx)
      userOverride?.(ctx)
    }
  })
}
