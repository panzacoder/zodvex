import type { GenericValidator } from 'convex/values'
import { v } from 'convex/values'
import { z } from 'zod'

// Helper: Convert Zod record types to Convex validators
export function convertRecordType(
  actualValidator: z.ZodRecord<any, any>,
  visited: Set<z.ZodTypeAny>,
  zodToConvexInternal: (schema: z.ZodTypeAny, visited: Set<z.ZodTypeAny>) => any
): GenericValidator {
  // In Zod v4, when z.record(z.string()) is used with one argument,
  // the argument becomes the value type and key defaults to string.
  // The valueType is stored in _def.valueType (or undefined if single arg)
  let valueType = (actualValidator as any)._def?.valueType

  // If valueType is undefined, it means single argument form was used
  // where the argument is actually the value type (stored in keyType)
  if (!valueType) {
    // Workaround: Zod v4 stores the value type in _def.keyType for single-argument z.record().
    // This accesses a private property as there is no public API for this in Zod v4.
    valueType = (actualValidator as any)._def?.keyType
  }

  if (valueType && valueType instanceof z.ZodType) {
    // First check if the Zod value type is optional before conversion
    const isZodOptional =
      valueType instanceof z.ZodOptional ||
      valueType instanceof z.ZodDefault ||
      (valueType instanceof z.ZodDefault && valueType.def.innerType instanceof z.ZodOptional)

    if (isZodOptional) {
      // For optional record values, we need to handle this specially
      let innerType: z.ZodTypeAny
      let recordDefaultValue: any = undefined
      let recordHasDefault = false

      if (valueType instanceof z.ZodDefault) {
        // Handle ZodDefault wrapper
        recordHasDefault = true
        recordDefaultValue = valueType.def.defaultValue
        const innerFromDefault = valueType.def.innerType
        if (innerFromDefault instanceof z.ZodOptional) {
          innerType = innerFromDefault.unwrap() as z.ZodTypeAny
        } else {
          innerType = innerFromDefault as z.ZodTypeAny
        }
      } else if (valueType instanceof z.ZodOptional) {
        // Direct ZodOptional
        innerType = valueType.unwrap() as z.ZodTypeAny
      } else {
        // Shouldn't happen based on isZodOptional check
        innerType = valueType as z.ZodTypeAny
      }

      // Convert the inner type to Convex and wrap in union with null
      const innerConvex = zodToConvexInternal(innerType, visited)
      const unionValidator = v.union(innerConvex, v.null())

      // Add default metadata if present
      if (recordHasDefault) {
        ;(unionValidator as any)._zodDefault = recordDefaultValue
      }

      return v.record(v.string(), unionValidator)
    } else {
      // Non-optional values can be converted normally
      return v.record(v.string(), zodToConvexInternal(valueType, visited))
    }
  } else {
    return v.record(v.string(), v.any())
  }
}
