import type { GenericValidator, Validator } from 'convex/values'
import { v } from 'convex/values'
import { $ZodDiscriminatedUnion, type $ZodType, $ZodUnion } from '../../zod-core'

// Combines validators into a single validator, falling back to v.any() when empty.
export function unionOf(validators: GenericValidator[]): GenericValidator {
  if (validators.length === 0) return v.any()
  if (validators.length === 1) return validators[0]
  const [first, second, ...rest] = validators as [
    GenericValidator,
    GenericValidator,
    ...GenericValidator[]
  ]
  return v.union(first, second, ...rest)
}

// Helper: Convert Zod discriminated union types to Convex validators
export function convertDiscriminatedUnionType(
  actualValidator: $ZodType,
  visited: Set<$ZodType>,
  zodToConvexInternal: (schema: $ZodType, visited: Set<$ZodType>) => any
): GenericValidator {
  const options =
    actualValidator instanceof $ZodDiscriminatedUnion
      ? actualValidator._zod.def.options
      : // cast: fallback for non-standard discriminated union variants
        (actualValidator as any)._zod?.def?.options
  if (options) {
    const opts = Array.isArray(options) ? options : Array.from(options)
    if (opts.length >= 2) {
      // IMPORTANT: Create a new visited set for each union member to prevent false circular
      // reference detection. The same schema can legitimately appear in multiple union branches.
      const convexOptions = opts.map((opt: any) => {
        const branchVisited = new Set(visited)
        return zodToConvexInternal(opt, branchVisited)
      }) as Validator<any, 'required', any>[]
      return unionOf(convexOptions)
    } else {
      return v.any()
    }
  } else {
    return v.any()
  }
}

// Helper: Convert Zod union types to Convex validators
export function convertUnionType(
  actualValidator: $ZodUnion,
  visited: Set<$ZodType>,
  zodToConvexInternal: (schema: $ZodType, visited: Set<$ZodType>) => any
): GenericValidator {
  const options = actualValidator._zod.def.options
  if (options && Array.isArray(options) && options.length > 0) {
    if (options.length === 1) {
      return zodToConvexInternal(options[0], visited)
    } else {
      // Convert each option recursively
      // IMPORTANT: Create a new visited set for each union member to prevent false circular
      // reference detection. The same schema can legitimately appear in multiple union branches.
      // However, we do want to preserve the parent visited set to catch actual circular refs
      // that involve the union itself.
      const convexOptions = options.map((opt: any) => {
        // Create a new Set that includes the parent's visited schemas but won't pollute it
        const branchVisited = new Set(visited)
        return zodToConvexInternal(opt, branchVisited)
      }) as Validator<any, 'required', any>[]
      if (convexOptions.length >= 2) {
        return unionOf(convexOptions)
      } else {
        return v.any()
      }
    }
  } else {
    return v.any()
  }
}
