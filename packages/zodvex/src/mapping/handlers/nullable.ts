import type { GenericValidator } from 'convex/values'
import { v } from 'convex/values'
import { $ZodNullable, $ZodOptional, $ZodType } from '../../zod-core'

// Helper: Convert Zod nullable types to Convex validators
export function convertNullableType(
  actualValidator: $ZodNullable,
  visited: Set<$ZodType>,
  zodToConvexInternal: (schema: $ZodType, visited: Set<$ZodType>) => any
): { validator: GenericValidator; isOptional: boolean } {
  const innerSchema = actualValidator._zod.def.innerType
  if (innerSchema && innerSchema instanceof $ZodType) {
    // Check if the inner schema is optional
    if (innerSchema instanceof $ZodOptional) {
      // For nullable(optional(T)), we want optional(union(T, null))
      const innerInnerSchema = innerSchema._zod.def.innerType
      const innerInnerValidator = zodToConvexInternal(innerInnerSchema, visited)
      return {
        validator: v.union(innerInnerValidator, v.null()),
        isOptional: true // Mark as optional so it gets wrapped later
      }
    } else {
      const innerValidator = zodToConvexInternal(innerSchema, visited)
      return {
        validator: v.union(innerValidator, v.null()),
        isOptional: false
      }
    }
  } else {
    return {
      validator: v.any(),
      isOptional: false
    }
  }
}
