import type { GenericValidator, Validator } from 'convex/values'
import { v } from 'convex/values'
import type { $ZodType } from '../../zod-core'

// Helper: Convert Zod enum types to Convex validators
export function convertEnumType(actualValidator: $ZodType): GenericValidator {
  // Enum .options is a getter returning entries keys. Use _zod.def.entries for core compat.
  const entries = (actualValidator as any)._zod.def.entries
  const options = entries ? Object.keys(entries) : (actualValidator as any).options
  if (options && Array.isArray(options) && options.length > 0) {
    // Filter out undefined/null and convert to Convex validators
    const validLiterals = options
      .filter((opt: any) => opt !== undefined && opt !== null)
      .map((opt: any) => v.literal(opt))

    if (validLiterals.length === 1) {
      const [first] = validLiterals
      return first as Validator<any, 'required', any>
    } else if (validLiterals.length >= 2) {
      const [first, second, ...rest] = validLiterals
      return v.union(
        first as Validator<any, 'required', any>,
        second as Validator<any, 'required', any>,
        ...rest
      )
    } else {
      return v.any()
    }
  } else {
    return v.any()
  }
}
