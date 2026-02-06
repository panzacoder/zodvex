import type { GenericValidator, PropertyValidators } from 'convex/values'
import { v } from 'convex/values'
import { z } from 'zod'
import { registryHelpers } from '../ids'
import {
  convertDiscriminatedUnionType,
  convertEnumType,
  convertNullableType,
  convertRecordType,
  convertUnionType
} from './handlers'
import type {
  ConvexValidatorFromZod,
  ConvexValidatorFromZodFieldsAuto,
  ZodValidator
} from './types'
import { getObjectShape, isZid } from './utils'

// Internal conversion function using ZodType with def.type detection
function zodToConvexInternal<Z extends z.ZodTypeAny>(
  zodValidator: Z,
  visited: Set<z.ZodTypeAny> = new Set()
): ConvexValidatorFromZod<Z, 'required'> {
  // Guard against undefined/null validators (can happen with { field: undefined } in args)
  if (!zodValidator) {
    return v.any() as ConvexValidatorFromZod<Z, 'required'>
  }

  // Detect circular references to prevent infinite recursion
  if (visited.has(zodValidator)) {
    return v.any() as ConvexValidatorFromZod<Z, 'required'>
  }
  visited.add(zodValidator)

  // Check for default and optional wrappers
  let actualValidator = zodValidator
  let isOptional = false
  let defaultValue: any = undefined
  let hasDefault = false

  // Handle ZodDefault (which wraps ZodOptional when using .optional().default())
  // Note: We access _def properties directly because Zod v4 doesn't expose public APIs
  // for unwrapping defaults. The removeDefault() method exists but returns a new schema
  // without preserving references, which breaks our visited Set tracking.
  if (zodValidator instanceof z.ZodDefault) {
    hasDefault = true
    defaultValue = (zodValidator as any).def?.defaultValue
    actualValidator = (zodValidator as any).def?.innerType as Z
  }

  // Check for optional (may be wrapped inside ZodDefault)
  if (actualValidator instanceof z.ZodOptional) {
    isOptional = true
    actualValidator = actualValidator.unwrap() as Z

    // If the unwrapped type is ZodDefault, handle it here
    if (actualValidator instanceof z.ZodDefault) {
      hasDefault = true
      defaultValue = (actualValidator as any).def?.defaultValue
      actualValidator = (actualValidator as any).def?.innerType as Z
    }
  }

  let convexValidator: GenericValidator

  // Check for Zid first (special case)
  if (isZid(actualValidator)) {
    const metadata = registryHelpers.getMetadata(actualValidator)
    const tableName = metadata?.tableName || 'unknown'
    convexValidator = v.id(tableName)
  } else {
    // Use def.type for robust, performant type detection instead of instanceof checks.
    // Rationale:
    // 1. Performance: Single switch statement vs. cascading instanceof checks
    // 2. Completeness: def.type covers ALL Zod variants including formats (email, url, uuid, etc.)
    // 3. Future-proof: Zod's internal structure is stable; instanceof checks can miss custom types
    // 4. Precision: def.type distinguishes between semantically different types (date vs number)
    // This private API access is intentional and necessary for comprehensive type coverage.
    //
    // Compatibility: This code relies on the internal `.def.type` property of ZodType.
    // This structure has been stable across Zod v3.x and v4.x. If upgrading Zod major versions,
    // verify that `.def.type` is still present and unchanged.
    const defType = (actualValidator as any).def?.type

    switch (defType) {
      case 'string':
        // This catches ZodString and ALL string format types (email, url, uuid, etc.)
        convexValidator = v.string()
        break
      case 'number':
        convexValidator = v.float64()
        break
      case 'bigint':
        convexValidator = v.int64()
        break
      case 'boolean':
        convexValidator = v.boolean()
        break
      case 'date':
        // LEGACY: Maps z.date() to v.float64() for backwards compatibility in type inference.
        // However, z.date() does NOT work at runtime because:
        // 1. z.date() produces Date objects, not numbers
        // 2. Convex rejects Date objects as non-serializable
        // 3. z.encode() on z.date() returns a Date, not a timestamp
        // Use zx.date() instead, which provides proper Date ↔ timestamp codec.
        // The wrappers and convexCodec will throw if z.date() is used.
        convexValidator = v.float64()
        break
      case 'null':
        convexValidator = v.null()
        break
      case 'nan':
        convexValidator = v.float64()
        break
      case 'array': {
        // Use classic API: ZodArray has .element property
        if (actualValidator instanceof z.ZodArray) {
          const element = (actualValidator as any).element
          if (element && element instanceof z.ZodType) {
            convexValidator = v.array(zodToConvexInternal(element, visited))
          } else {
            convexValidator = v.array(v.any())
          }
        } else {
          convexValidator = v.array(v.any())
        }
        break
      }
      case 'object': {
        // Use classic API: ZodObject has .shape property
        if (actualValidator instanceof z.ZodObject) {
          const shape = actualValidator.shape
          const convexShape: PropertyValidators = {}
          for (const [key, value] of Object.entries(shape)) {
            if (value && value instanceof z.ZodType) {
              convexShape[key] = zodToConvexInternal(value, visited)
            }
          }
          convexValidator = v.object(convexShape)
        } else {
          convexValidator = v.object({})
        }
        break
      }
      case 'union': {
        if (actualValidator instanceof z.ZodUnion) {
          convexValidator = convertUnionType(actualValidator, visited, zodToConvexInternal)
        } else {
          convexValidator = v.any()
        }
        break
      }
      case 'discriminatedUnion': {
        convexValidator = convertDiscriminatedUnionType(
          actualValidator as any,
          visited,
          zodToConvexInternal
        )
        break
      }
      case 'literal': {
        // Use classic API: ZodLiteral has .value property
        if (actualValidator instanceof z.ZodLiteral) {
          const literalValue = (actualValidator as any).value
          if (literalValue !== undefined && literalValue !== null) {
            convexValidator = v.literal(literalValue)
          } else {
            convexValidator = v.any()
          }
        } else {
          convexValidator = v.any()
        }
        break
      }
      case 'enum': {
        if (actualValidator instanceof z.ZodEnum) {
          convexValidator = convertEnumType(actualValidator)
        } else {
          convexValidator = v.any()
        }
        break
      }
      case 'record': {
        if (actualValidator instanceof z.ZodRecord) {
          convexValidator = convertRecordType(actualValidator, visited, zodToConvexInternal)
        } else {
          convexValidator = v.record(v.string(), v.any())
        }
        break
      }
      case 'transform':
      case 'pipe': {
        // Check for native Zod v4 codec first (z.codec())
        // Codecs have def.type='pipe' but are specifically for bidirectional transforms
        // Use the input schema (wire format) for Convex validation
        if (actualValidator instanceof z.ZodCodec) {
          const inputSchema = (actualValidator as any).def?.in
          if (inputSchema && inputSchema instanceof z.ZodType) {
            convexValidator = zodToConvexInternal(inputSchema, visited)
          } else {
            convexValidator = v.any()
          }
        } else {
          // Check for brand metadata
          const metadata = registryHelpers.getMetadata(actualValidator)
          if (metadata?.brand && metadata?.originalSchema) {
            // For branded types created by our zBrand function, use the original schema
            convexValidator = zodToConvexInternal(metadata.originalSchema, visited)
          } else {
            // Non-codec transform - extract input schema but warn
            const inputSchema = (actualValidator as any).def?.in
            if (inputSchema && inputSchema instanceof z.ZodType) {
              if (process.env.NODE_ENV !== 'production') {
                console.warn(
                  '[zodvex] z.transform() detected. Using input schema for Convex validation.\n' +
                    'Transforms are unidirectional - they work for parsing but not encoding.\n' +
                    'For bidirectional transforms, use zx.codec() instead.'
                )
              }
              convexValidator = zodToConvexInternal(inputSchema, visited)
            } else {
              convexValidator = v.any()
            }
          }
        }
        break
      }
      case 'nullable': {
        if (actualValidator instanceof z.ZodNullable) {
          const result = convertNullableType(actualValidator, visited, zodToConvexInternal)
          convexValidator = result.validator
          if (result.isOptional) {
            isOptional = true
          }
        } else {
          convexValidator = v.any()
        }
        break
      }
      case 'tuple': {
        // Handle tuple types as objects with numeric keys
        if (actualValidator instanceof z.ZodTuple) {
          const items = (actualValidator as any).def?.items as z.ZodTypeAny[] | undefined
          if (items && items.length > 0) {
            const convexShape: PropertyValidators = {}
            items.forEach((item, index) => {
              convexShape[`_${index}`] = zodToConvexInternal(item, visited)
            })
            convexValidator = v.object(convexShape)
          } else {
            convexValidator = v.object({})
          }
        } else {
          convexValidator = v.object({})
        }
        break
      }
      case 'lazy': {
        // Handle lazy schemas by resolving them
        // Circular references are protected by the visited set check at function start
        if (actualValidator instanceof z.ZodLazy) {
          try {
            const getter = (actualValidator as any).def?.getter
            if (getter) {
              const resolvedSchema = getter()
              if (resolvedSchema && resolvedSchema instanceof z.ZodType) {
                convexValidator = zodToConvexInternal(resolvedSchema, visited)
              } else {
                convexValidator = v.any()
              }
            } else {
              convexValidator = v.any()
            }
          } catch {
            // If resolution fails, fall back to 'any'
            convexValidator = v.any()
          }
        } else {
          convexValidator = v.any()
        }
        break
      }
      case 'any':
        // Handle z.any() directly
        convexValidator = v.any()
        break
      case 'unknown':
        // Handle z.unknown() as any
        convexValidator = v.any()
        break
      case 'undefined':
      case 'void':
      case 'never':
        // These types don't have good Convex equivalents
        convexValidator = v.any()
        break
      case 'intersection':
        // Can't properly handle intersections
        convexValidator = v.any()
        break
      case 'optional': {
        // Fallback for optional types that weren't caught by the instanceof check at line 53.
        // This can happen when pipes/codecs are wrapped with .optional() - the instanceof
        // z.ZodOptional check fails but def.type is still 'optional'.
        const innerType =
          (actualValidator as any).def?.innerType ?? (actualValidator as any).unwrap?.()
        if (innerType && innerType instanceof z.ZodType) {
          convexValidator = zodToConvexInternal(innerType, visited)
          isOptional = true
        } else {
          convexValidator = v.any()
          isOptional = true
        }
        break
      }
      default:
        // For any unrecognized def.type, return v.any()
        // No instanceof fallbacks - keep it simple and performant
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `[zodvex] Unrecognized Zod type "${defType}" encountered. Falling back to v.any().`,
            'Schema:',
            actualValidator
          )
        }
        convexValidator = v.any()
        break
    }
  }

  // For optional or default fields, always use v.optional()
  const finalValidator = isOptional || hasDefault ? v.optional(convexValidator) : convexValidator

  // Add metadata if there's a default value
  if (hasDefault && typeof finalValidator === 'object' && finalValidator !== null) {
    ;(finalValidator as any)._zodDefault = defaultValue
  }

  return finalValidator as ConvexValidatorFromZod<Z, 'required'>
}

export function zodToConvex<Z extends z.ZodTypeAny | ZodValidator>(
  zod: Z
): Z extends z.ZodTypeAny
  ? ConvexValidatorFromZod<Z, 'required'>
  : Z extends ZodValidator
    ? ConvexValidatorFromZodFieldsAuto<Z>
    : never {
  if (typeof zod === 'object' && zod !== null && !(zod instanceof z.ZodType)) {
    return zodToConvexFields(zod as ZodValidator) as any
  }

  return zodToConvexInternal(zod as z.ZodTypeAny) as any
}

export function zodToConvexFields<Z extends z.ZodRawShape>(
  zod: Z
): ConvexValidatorFromZodFieldsAuto<Z> {
  // If it's a ZodObject, extract the shape
  const fields = zod instanceof z.ZodObject ? zod.shape : zod

  // Build the result object directly to preserve types
  const result: any = {}
  for (const [key, value] of Object.entries(fields)) {
    result[key] = zodToConvexInternal(value as z.ZodTypeAny)
  }

  return result as ConvexValidatorFromZodFieldsAuto<Z>
}
