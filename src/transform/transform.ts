/**
 * Value transformation utilities.
 *
 * General-purpose utilities for recursively transforming values based on their schema structure.
 */

import type { z } from 'zod'
import type { AsyncTransformFn, TransformContext, TransformFn, TransformOptions } from './types'
import { getMetadata } from './traverse'

/**
 * Recursively transform a value based on its schema structure.
 *
 * The transform function is called for each value/schema pair during traversal.
 * If the transform returns a different value (val !== transformed), that value
 * is used and recursion into that subtree stops. If the same value is returned,
 * recursion continues.
 *
 * @example
 * ```ts
 * // Mask all fields with 'pii' metadata for logging
 * const safeForLogs = transformBySchema(userData, userSchema, null, (value, ctx) => {
 *   if (ctx.meta?.pii) {
 *     return '[REDACTED]'
 *   }
 *   return value
 * })
 * ```
 */
export function transformBySchema<T, TCtx>(
  value: T,
  schema: z.ZodTypeAny,
  ctx: TCtx,
  transform: TransformFn<TCtx>,
  options?: TransformOptions<TCtx>
): T {
  const basePath = options?.path ?? ''

  function recurse(val: unknown, sch: z.ZodTypeAny, currentPath: string): unknown {
    // Pass through null/undefined unchanged
    if (val === undefined || val === null) {
      return val
    }

    const defType = (sch as any)._def?.type as string | undefined

    // Check shouldTransform predicate - if false, skip callback but continue recursion
    const shouldCall = !options?.shouldTransform || options.shouldTransform(sch)

    if (shouldCall) {
      const meta = getMetadata(sch)

      // Call transform for this value/schema pair
      const context: TransformContext<TCtx> = { path: currentPath, schema: sch, meta, ctx }
      const transformed = transform(val, context)

      // If transform returned something different, use it (don't recurse)
      if (transformed !== val) {
        return transformed
      }
    }

    // Dispatch based on schema type
    switch (defType) {
      case 'optional':
      case 'nullable': {
        if (val === null) return null
        const inner = (sch as any).unwrap()
        return recurse(val, inner, currentPath)
      }

      case 'lazy': {
        const getter = (sch as any)._def?.getter
        if (typeof getter === 'function') {
          const inner = getter()
          return recurse(val, inner, currentPath)
        }
        break
      }

      case 'object': {
        if (typeof val === 'object' && val !== null) {
          const shape = (sch as any).shape
          if (shape) {
            const result: Record<string, unknown> = {}
            for (const [key, fieldSchema] of Object.entries(shape)) {
              const fieldPath = currentPath ? `${currentPath}.${key}` : key
              const fieldValue = (val as Record<string, unknown>)[key]
              result[key] = recurse(fieldValue, fieldSchema as z.ZodTypeAny, fieldPath)
            }
            return result
          }
        }
        break
      }

      case 'array': {
        if (Array.isArray(val)) {
          const element = (sch as any).element
          return val.map((item, i) => {
            const itemPath = `${currentPath}[${i}]`
            return recurse(item, element, itemPath)
          })
        }
        break
      }

      case 'union':
        return handleUnion(val, sch, currentPath, recurse, options)
    }

    return val
  }

  return recurse(value, schema, basePath) as T
}

/**
 * Async version of transformBySchema.
 *
 * Supports async transform functions for operations like policy resolution
 * or encryption with async key lookup.
 *
 * @example
 * ```ts
 * // Apply security policies (async entitlement checks)
 * const limited = await transformBySchemaAsync(doc, schema, ctx, async (value, info) => {
 *   if (isSensitive(info.meta)) {
 *     const decision = await resolvePolicy(info, ctx)
 *     return applyDecision(value, decision)
 *   }
 *   return value
 * })
 * ```
 */
export async function transformBySchemaAsync<T, TCtx>(
  value: T,
  schema: z.ZodTypeAny,
  ctx: TCtx,
  transform: AsyncTransformFn<TCtx>,
  options?: TransformOptions<TCtx>
): Promise<T> {
  const basePath = options?.path ?? ''

  async function recurse(val: unknown, sch: z.ZodTypeAny, currentPath: string): Promise<unknown> {
    // Pass through null/undefined unchanged
    if (val === undefined || val === null) {
      return val
    }

    const defType = (sch as any)._def?.type as string | undefined

    // Check shouldTransform predicate - if false, skip callback but continue recursion
    const shouldCall = !options?.shouldTransform || options.shouldTransform(sch)

    if (shouldCall) {
      const meta = getMetadata(sch)

      // Call transform for this value/schema pair
      const context: TransformContext<TCtx> = { path: currentPath, schema: sch, meta, ctx }
      const transformed = await transform(val, context)

      // If transform returned something different, use it
      if (transformed !== val) {
        return transformed
      }
    }

    // Dispatch based on schema type
    switch (defType) {
      case 'optional':
      case 'nullable': {
        if (val === null) return null
        const inner = (sch as any).unwrap()
        return recurse(val, inner, currentPath)
      }

      case 'lazy': {
        const getter = (sch as any)._def?.getter
        if (typeof getter === 'function') {
          const inner = getter()
          return recurse(val, inner, currentPath)
        }
        break
      }

      case 'object': {
        if (typeof val === 'object' && val !== null) {
          const shape = (sch as any).shape
          if (shape) {
            const result: Record<string, unknown> = {}
            for (const [key, fieldSchema] of Object.entries(shape)) {
              const fieldPath = currentPath ? `${currentPath}.${key}` : key
              const fieldValue = (val as Record<string, unknown>)[key]
              result[key] = await recurse(fieldValue, fieldSchema as z.ZodTypeAny, fieldPath)
            }
            return result
          }
        }
        break
      }

      case 'array': {
        if (Array.isArray(val)) {
          const element = (sch as any).element
          if (options?.parallel) {
            // Parallel processing with Promise.all
            return Promise.all(
              val.map((item, i) => {
                const itemPath = `${currentPath}[${i}]`
                return recurse(item, element, itemPath)
              })
            )
          }
          // Sequential processing (default)
          const results: unknown[] = []
          for (let i = 0; i < val.length; i++) {
            const itemPath = `${currentPath}[${i}]`
            results.push(await recurse(val[i], element, itemPath))
          }
          return results
        }
        break
      }

      case 'union':
        return handleUnionAsync(val, sch, currentPath, recurse, options)
    }

    return val
  }

  return recurse(value, schema, basePath) as Promise<T>
}

/**
 * Handle union matching for sync transforms.
 */
function handleUnion(
  val: unknown,
  sch: z.ZodTypeAny,
  currentPath: string,
  recurse: (v: unknown, s: z.ZodTypeAny, p: string) => unknown,
  options?: TransformOptions
): unknown {
  const unionOptions = (sch as any)._def.options as z.ZodTypeAny[] | undefined
  const discriminator = (sch as any)._def?.discriminator

  // Discriminated union - find matching variant by discriminator value
  if (discriminator && typeof val === 'object' && val !== null && unionOptions) {
    const discValue = (val as Record<string, unknown>)[discriminator]

    for (const variant of unionOptions) {
      const variantShape = (variant as any).shape
      if (variantShape) {
        const discField = variantShape[discriminator]
        if ((discField as any)?._def?.type === 'literal') {
          // Zod v4 stores literal values in _def.values array
          const literalValues = (discField as any)._def.values as unknown[]
          if (literalValues?.includes(discValue)) {
            return recurse(val, variant, currentPath)
          }
        }
      }
    }

    // No variant matched - handle according to options
    return handleUnmatchedUnion(val, currentPath, options)
  }

  // Regular union - try each variant
  if (unionOptions) {
    for (const variant of unionOptions) {
      try {
        const result = recurse(val, variant, currentPath)
        // If we got a non-null result, use it
        if (result !== null) return result
      } catch {
        // This variant didn't work, try next
      }
    }
  }

  // No variant matched for regular union
  return handleUnmatchedUnion(val, currentPath, options)
}

/**
 * Handle union matching for async transforms.
 */
async function handleUnionAsync(
  val: unknown,
  sch: z.ZodTypeAny,
  currentPath: string,
  recurse: (v: unknown, s: z.ZodTypeAny, p: string) => Promise<unknown>,
  options?: TransformOptions
): Promise<unknown> {
  const unionOptions = (sch as any)._def.options as z.ZodTypeAny[] | undefined
  const discriminator = (sch as any)._def?.discriminator

  // Discriminated union - find matching variant by discriminator value
  if (discriminator && typeof val === 'object' && val !== null && unionOptions) {
    const discValue = (val as Record<string, unknown>)[discriminator]

    for (const variant of unionOptions) {
      const variantShape = (variant as any).shape
      if (variantShape) {
        const discField = variantShape[discriminator]
        if ((discField as any)?._def?.type === 'literal') {
          const literalValues = (discField as any)._def.values as unknown[]
          if (literalValues?.includes(discValue)) {
            return recurse(val, variant, currentPath)
          }
        }
      }
    }

    return handleUnmatchedUnion(val, currentPath, options)
  }

  // Regular union - try each variant
  if (unionOptions) {
    for (const variant of unionOptions) {
      try {
        const result = await recurse(val, variant, currentPath)
        if (result !== null) return result
      } catch {
        // Try next variant
      }
    }
  }

  return handleUnmatchedUnion(val, currentPath, options)
}

/**
 * Handle unmatched union according to options.
 */
function handleUnmatchedUnion(val: unknown, path: string, options?: TransformOptions): unknown {
  options?.onUnmatchedUnion?.(path)

  switch (options?.unmatchedUnion) {
    case 'error':
      throw new Error(`No union variant matched at path: ${path}`)
    case 'null':
      return null
    case 'passthrough':
    default:
      return val
  }
}
