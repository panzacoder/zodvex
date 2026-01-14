/**
 * Apply policy transforms to values.
 *
 * This module provides functions to:
 * - Transform sensitive fields for read access (applyReadPolicy)
 * - Validate write permissions for sensitive fields (validateWritePolicy, assertWriteAllowed)
 *
 * Uses the transform layer's transformBySchemaAsync for recursive value transformation.
 */

import type { z } from 'zod'
import { transformBySchemaAsync } from '../transform'
import { resolveReadPolicy, resolveWritePolicy } from './policy'
import { getSensitiveMetadata } from './sensitive'
import type {
  EntitlementResolver,
  PolicyContext,
  ReasonCode,
  SensitiveDb,
  SensitiveWire
} from './types'

// ============================================================================
// Read Policy Application
// ============================================================================

/**
 * Options for applyReadPolicy.
 */
export interface ApplyReadPolicyOptions<TDoc = unknown> {
  /** Starting path prefix for field paths */
  path?: string
  /** The document being accessed (for owner-based policies) */
  doc?: TDoc
  /** Default reason when access is denied */
  defaultDenyReason?: ReasonCode
  /**
   * How to handle a SensitiveDb value when the schema at that path is NOT marked as sensitive.
   * This is a fail-secure guard against traversal/marking gaps.
   *
   * Default: 'throw'
   */
  orphanedSensitive?: 'throw' | 'redact' | 'passthrough'
  /** Callback when fail-closed occurs (union doesn't match) */
  onFailClosed?: (path: string, reason: string) => void
}

/**
 * Check if a value looks like a SensitiveDb wrapper.
 */
function isSensitiveDbValue(value: unknown): value is SensitiveDb<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__sensitiveValue' in value &&
    !('status' in value)
  )
}

function handleOrphanedSensitiveDbValue(
  path: string,
  value: SensitiveDb<unknown>,
  mode: NonNullable<ApplyReadPolicyOptions['orphanedSensitive']>,
  defaultDenyReason?: ReasonCode
): SensitiveDb<unknown> | SensitiveWire {
  switch (mode) {
    case 'passthrough':
      return value
    case 'redact':
      return {
        status: 'hidden',
        value: null,
        reason: defaultDenyReason ?? 'unhandled_sensitive_field'
      }
    case 'throw':
    default:
      throw new Error(
        `Security Error: SensitiveDb value found at '${path}' but schema is not marked sensitive.\n` +
          `This would allow raw sensitive data to escape policy application.\n` +
          `Fix: mark the field with sensitive(...), and avoid patterns that hide .meta() (e.g. sensitive(...).transform(...)).`
      )
  }
}

/**
 * Apply read policy transforms to a value based on its schema.
 *
 * Uses the transform layer's transformBySchemaAsync for recursive traversal,
 * applying security-specific transformation for sensitive fields.
 *
 * @param value - The value to transform (typically from DB)
 * @param schema - The Zod schema describing the value
 * @param ctx - The context for policy resolution (e.g., QueryCtx)
 * @param resolver - Function to check entitlements
 * @param options - Additional options
 * @returns The transformed value with sensitive fields in wire format
 */
export async function applyReadPolicy<T, TCtx, TReq, TDoc = unknown>(
  value: T,
  schema: z.ZodTypeAny,
  ctx: TCtx,
  resolver: EntitlementResolver<TCtx, TReq, TDoc>,
  options?: ApplyReadPolicyOptions<TDoc>
): Promise<T> {
  const orphanedSensitiveMode = options?.orphanedSensitive ?? 'throw'

  return transformBySchemaAsync(
    value,
    schema,
    ctx,
    async (val, info) => {
      // Fail-secure: detect SensitiveDb wrappers that aren't covered by schema marking.
      if (isSensitiveDbValue(val)) {
        const meta = getSensitiveMetadata<TReq>(info.schema)
        if (!meta) {
          return handleOrphanedSensitiveDbValue(
            info.path,
            val,
            orphanedSensitiveMode,
            options?.defaultDenyReason
          )
        }
      }

      // Check if this schema is sensitive and value is SensitiveDb
      const meta = getSensitiveMetadata<TReq>(info.schema)
      if (!meta || !isSensitiveDbValue(val)) {
        return val // Not sensitive or not a SensitiveDb value, return unchanged
      }

      // Resolve the read policy
      const context: PolicyContext<TCtx, TReq, TDoc> = {
        ctx: info.ctx,
        path: info.path,
        meta,
        doc: options?.doc,
        operation: 'read'
      }

      const readPolicies = meta.read ?? []
      const decision = await resolveReadPolicy(context, readPolicies, resolver, {
        defaultDenyReason: options?.defaultDenyReason
      })

      // Transform to wire format
      const wire: SensitiveWire = {
        status: decision.status,
        value: null,
        reason: decision.reason
      }

      if (decision.status === 'full') {
        wire.value = val.__sensitiveValue
      } else if (decision.status === 'masked' && decision.mask) {
        wire.value = decision.mask(val.__sensitiveValue)
      }
      // For 'hidden', value stays null

      return wire
    },
    {
      path: options?.path,
      unmatchedUnion: 'null', // Fail-closed for security
      onUnmatchedUnion: path => options?.onFailClosed?.(path, 'union_no_variant_matched')
    }
  )
}

// ============================================================================
// Write Policy Validation
// ============================================================================

/**
 * Result of write policy validation.
 */
export interface WriteValidationResult {
  /** Whether all writes are allowed */
  allowed: boolean
  /** List of fields that were denied */
  deniedFields: Array<{ path: string; reason?: ReasonCode }>
}

/**
 * Options for write policy validation.
 */
export interface ValidateWritePolicyOptions {
  /** Starting path prefix */
  path?: string
  /** Default reason for denials */
  defaultDenyReason?: ReasonCode
}

/**
 * Validate write policies for all sensitive fields in a value.
 *
 * Unlike read policies, write validation is binary - either all sensitive
 * fields pass their write policy, or the operation should be rejected.
 *
 * Returns all denied fields (not just the first), so error messages
 * can indicate all problems at once.
 *
 * @param value - The value being written
 * @param schema - The Zod schema
 * @param ctx - The context for policy resolution
 * @param resolver - Function to check entitlements
 * @param options - Additional options
 * @returns Validation result with allowed flag and denied fields
 */
export async function validateWritePolicy<TCtx, TReq, TDoc = unknown>(
  value: unknown,
  schema: z.ZodTypeAny,
  ctx: TCtx,
  resolver: EntitlementResolver<TCtx, TReq, TDoc>,
  options?: ValidateWritePolicyOptions
): Promise<WriteValidationResult> {
  const basePath = options?.path ?? ''
  const deniedFields: Array<{ path: string; reason?: ReasonCode }> = []

  async function validate(val: unknown, sch: z.ZodTypeAny, currentPath: string): Promise<void> {
    if (val === undefined || val === null) {
      return
    }

    const defType = (sch as any)._def?.type as string | undefined

    // Check if this schema is sensitive and value is present
    const meta = getSensitiveMetadata<TReq>(sch)
    if (meta && isSensitiveDbValue(val)) {
      // Resolve the write policy
      const context: PolicyContext<TCtx, TReq, TDoc> = {
        ctx,
        path: currentPath,
        meta,
        operation: 'write'
      }

      const decision = await resolveWritePolicy(context, meta.write, resolver, {
        defaultDenyReason: options?.defaultDenyReason
      })

      if (!decision.allowed) {
        deniedFields.push({ path: currentPath, reason: decision.reason })
      }
      return
    }

    // Dispatch based on schema type
    switch (defType) {
      case 'optional': {
        const inner = (sch as any).unwrap()
        return validate(val, inner, currentPath)
      }

      case 'nullable': {
        if (val === null) return
        const inner = (sch as any).unwrap()
        return validate(val, inner, currentPath)
      }

      case 'lazy': {
        const getter = (sch as any)._def?.getter
        if (typeof getter === 'function') {
          const inner = getter()
          return validate(val, inner, currentPath)
        }
        return
      }

      case 'default':
      case 'catch':
      case 'readonly':
      case 'prefault':
      case 'nonoptional': {
        const inner = (sch as any)._def?.innerType as z.ZodTypeAny | undefined
        if (inner) {
          return validate(val, inner, currentPath)
        }
        return
      }

      case 'pipe': {
        const inner = (sch as any)._def?.in as z.ZodTypeAny | undefined
        if (inner) {
          return validate(val, inner, currentPath)
        }
        return
      }

      case 'object': {
        if (typeof val === 'object' && val !== null) {
          const shape = (sch as any).shape
          if (shape) {
            for (const [key, fieldSchema] of Object.entries(shape)) {
              const fieldPath = currentPath ? `${currentPath}.${key}` : key
              const fieldValue = (val as Record<string, unknown>)[key]
              if (fieldValue !== undefined) {
                await validate(fieldValue, fieldSchema as z.ZodTypeAny, fieldPath)
              }
            }
          }
        }
        break
      }

      case 'array': {
        if (Array.isArray(val)) {
          const element = (sch as any).element
          for (let i = 0; i < val.length; i++) {
            const itemPath = `${currentPath}[${i}]`
            await validate(val[i], element, itemPath)
          }
        }
        break
      }

      case 'union': {
        const unionOptions = (sch as any)._def.options as z.ZodTypeAny[] | undefined
        const discriminator = (sch as any)._def?.discriminator

        if (discriminator && typeof val === 'object' && val !== null && unionOptions) {
          const discValue = (val as Record<string, unknown>)[discriminator]

          for (const variant of unionOptions) {
            const variantShape = (variant as any).shape
            if (variantShape) {
              const discField = variantShape[discriminator]
              const discDefType = (discField as any)?._def?.type

              if (discDefType === 'literal') {
                const literalValues = (discField as any)._def.values as unknown[]
                if (literalValues?.includes(discValue)) {
                  await validate(val, variant, currentPath)
                  return
                }
              }
            }
          }
        }

        // For regular unions, validate against all matching variants
        if (unionOptions) {
          for (const variant of unionOptions) {
            await validate(val, variant, currentPath)
          }
        }
        break
      }
    }
  }

  await validate(value, schema, basePath)

  return {
    allowed: deniedFields.length === 0,
    deniedFields
  }
}

/**
 * Assert that all writes to sensitive fields are allowed.
 *
 * Throws an error if any sensitive field write is denied.
 *
 * @param value - The value being written
 * @param schema - The Zod schema
 * @param ctx - The context for policy resolution
 * @param resolver - Function to check entitlements
 * @throws Error if any write is denied
 */
export async function assertWriteAllowed<TCtx, TReq, TDoc = unknown>(
  value: unknown,
  schema: z.ZodTypeAny,
  ctx: TCtx,
  resolver: EntitlementResolver<TCtx, TReq, TDoc>
): Promise<void> {
  const result = await validateWritePolicy(value, schema, ctx, resolver)

  if (!result.allowed) {
    const fieldList = result.deniedFields.map(f => f.path).join(', ')
    throw new Error(`Write denied for sensitive fields: ${fieldList}`)
  }
}
