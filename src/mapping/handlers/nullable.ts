import type { GenericValidator } from 'convex/values'
import { v } from 'convex/values'
import { z } from 'zod'

// Helper: Convert Zod nullable types to Convex validators
export function convertNullableType(
  actualValidator: z.ZodNullable<any>,
  visited: Set<z.ZodTypeAny>,
  zodToConvexInternal: (schema: z.ZodTypeAny, visited: Set<z.ZodTypeAny>) => any
): { validator: GenericValidator; isOptional: boolean } {
  const innerSchema = actualValidator.unwrap()
  if (innerSchema && innerSchema instanceof z.ZodType) {
    // Check if the inner schema is optional
    if (innerSchema instanceof z.ZodOptional) {
      // For nullable(optional(T)), we want optional(union(T, null))
      const innerInnerSchema = innerSchema.unwrap()
      const innerInnerValidator = zodToConvexInternal(innerInnerSchema as z.ZodType, visited)
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
