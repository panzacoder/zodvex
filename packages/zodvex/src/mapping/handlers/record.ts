import type { GenericValidator } from 'convex/values'
import { v } from 'convex/values'
import { $ZodDefault, $ZodOptional, $ZodRecord, $ZodType } from '../../zod-core'

// Helper: Convert Zod record types to Convex validators
export function convertRecordType(
  actualValidator: $ZodRecord,
  visited: Set<$ZodType>,
  zodToConvexInternal: (schema: $ZodType, visited: Set<$ZodType>) => any
): GenericValidator {
  // $ZodRecord._zod.def has keyType and valueType
  let valueType: $ZodType | undefined = actualValidator._zod.def.valueType

  // If valueType is undefined, fall back to keyType (single-argument z.record() form)
  if (!valueType) {
    valueType = actualValidator._zod.def.keyType
  }

  if (valueType && valueType instanceof $ZodType) {
    // First check if the Zod value type is optional before conversion
    const isZodOptional =
      valueType instanceof $ZodOptional ||
      valueType instanceof $ZodDefault ||
      (valueType instanceof $ZodDefault && valueType._zod.def.innerType instanceof $ZodOptional)

    if (isZodOptional) {
      // For optional record values, we need to handle this specially
      let innerType: any
      let recordDefaultValue: any = undefined
      let recordHasDefault = false

      if (valueType instanceof $ZodDefault) {
        // Handle ZodDefault wrapper
        recordHasDefault = true
        recordDefaultValue = valueType._zod.def.defaultValue
        const innerFromDefault = valueType._zod.def.innerType
        if (innerFromDefault instanceof $ZodOptional) {
          innerType = innerFromDefault._zod.def.innerType
        } else {
          innerType = innerFromDefault
        }
      } else if (valueType instanceof $ZodOptional) {
        // Direct ZodOptional
        innerType = valueType._zod.def.innerType
      } else {
        // Shouldn't happen based on isZodOptional check
        innerType = valueType
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
