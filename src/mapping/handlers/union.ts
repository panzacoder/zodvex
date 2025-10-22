import type { GenericValidator, Validator } from 'convex/values'
import { v } from 'convex/values'
import { z } from 'zod'

// Helper: Convert Zod discriminated union types to Convex validators
export function convertDiscriminatedUnionType(
  actualValidator: z.ZodDiscriminatedUnion<any, any>,
  visited: Set<z.ZodTypeAny>,
  zodToConvexInternal: (schema: z.ZodTypeAny, visited: Set<z.ZodTypeAny>) => any
): GenericValidator {
  const options =
    (actualValidator as any).def?.options || (actualValidator as any).def?.optionsMap?.values()
  if (options) {
    const opts = Array.isArray(options) ? options : Array.from(options)
    if (opts.length >= 2) {
      // IMPORTANT: Create a new visited set for each union member to prevent false circular
      // reference detection. The same schema can legitimately appear in multiple union branches.
      const convexOptions = opts.map((opt: any) => {
        const branchVisited = new Set(visited)
        return zodToConvexInternal(opt, branchVisited)
      }) as Validator<any, 'required', any>[]
      const [first, second, ...rest] = convexOptions
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

// Helper: Convert Zod union types to Convex validators
export function convertUnionType(
  actualValidator: z.ZodUnion<any>,
  visited: Set<z.ZodTypeAny>,
  zodToConvexInternal: (schema: z.ZodTypeAny, visited: Set<z.ZodTypeAny>) => any
): GenericValidator {
  const options = (actualValidator as any).options
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
        const [first, second, ...rest] = convexOptions
        return v.union(
          first as Validator<any, 'required', any>,
          second as Validator<any, 'required', any>,
          ...rest
        )
      } else {
        return v.any()
      }
    }
  } else {
    return v.any()
  }
}
