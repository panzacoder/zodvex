import type { GenericValidator } from 'convex/values'
import { v } from 'convex/values'
import { $ZodDefault, $ZodOptional, $ZodType } from '../../zod-core'

// Helper: Convert Zod record types to Convex validators
export function convertRecordType(
  actualValidator: any,
  visited: Set<any>,
  zodToConvexInternal: (schema: any, visited: Set<any>) => any
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

  if (valueType && valueType instanceof $ZodType) {
    // First check if the Zod value type is optional before conversion
    const isZodOptional =
      valueType instanceof $ZodOptional ||
      valueType instanceof $ZodDefault ||
      (valueType instanceof $ZodDefault && (valueType as any).def.innerType instanceof $ZodOptional)

    if (isZodOptional) {
      // For optional record values, we need to handle this specially
      let innerType: any
      let recordDefaultValue: any = undefined
      let recordHasDefault = false

      if (valueType instanceof $ZodDefault) {
        // Handle ZodDefault wrapper
        recordHasDefault = true
        recordDefaultValue = (valueType as any).def.defaultValue
        const innerFromDefault = (valueType as any).def.innerType
        if (innerFromDefault instanceof $ZodOptional) {
          innerType = (innerFromDefault as any)._zod.def.innerType
        } else {
          innerType = innerFromDefault
        }
      } else if (valueType instanceof $ZodOptional) {
        // Direct ZodOptional
        innerType = (valueType as any)._zod.def.innerType
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
