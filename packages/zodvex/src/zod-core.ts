// Central re-export of zod/v4/core types and functions.
// zodvex uses these for instanceof checks and standalone parse/encode operations.
//
// Per Zod's library author guidance (https://zod.dev/library-authors),
// importing from 'zod/v4/core' ensures zodvex works with both zod and zod/mini.
// Schema construction uses the swappable factory (getZ) set by the entrypoint.
export {
  $ZodAny,
  $ZodArray,
  $ZodBigInt,
  $ZodBoolean,
  $ZodCodec,
  $ZodCustom,
  $ZodDate,
  $ZodDefault,
  $ZodDiscriminatedUnion,
  $ZodEnum,
  // Errors
  $ZodError,
  // File
  $ZodFile,
  $ZodLazy,
  $ZodLiteral,
  type $ZodLooseShape,
  $ZodNaN,
  $ZodNever,
  $ZodNonOptional,
  $ZodNull,
  $ZodNullable,
  $ZodNumber,
  // Compound types
  $ZodObject,
  // Object config types
  type $ZodObjectInternals,
  // Wrappers
  $ZodOptional,
  $ZodPipe,
  $ZodPrefault,
  $ZodReadonly,
  $ZodRecord,
  // Shape types (equivalent to z.ZodRawShape)
  type $ZodShape,
  $ZodString,
  $ZodSymbol,
  // Transform/pipe
  $ZodTransform,
  $ZodTuple,
  // Base types
  $ZodType,
  // Internals for advanced type checking
  type $ZodTypeDef,
  type $ZodTypeInternals,
  $ZodUndefined,
  $ZodUnion,
  $ZodUnknown,
  $ZodVoid,
  // Clone utility — creates a new instance preserving the original's class
  clone,
  decode,
  encode,
  // Type utilities
  type infer,
  type input,
  type output,
  // Standalone parse/encode functions
  parse,
  parseAsync,
  safeParse,
  safeParseAsync
} from 'zod/v4/core'

// ---------------------------------------------------------------------------
// Swappable z namespace — the entrypoint (core/ or mini/) calls setZodFactory()
// at module load time, before any schema construction runs.
// ---------------------------------------------------------------------------
import type { z as ZodNamespace } from 'zod'

/**
 * The z namespace type. Compatible with both `zod` and `zod/mini` since
 * mini exports the same construction functions (object, array, string, etc.).
 */
export type ZodFactory = typeof ZodNamespace

let _z: ZodFactory | undefined

/**
 * Set the Zod namespace used for all internal schema construction.
 * Called once by the entrypoint module (zodvex/core or zodvex/mini).
 */
export function setZodFactory(z: ZodFactory): void {
  _z = z
}

/**
 * Get the current Zod namespace. Throws if no entrypoint has been loaded.
 *
 * In production, the entrypoint (zodvex/core, zodvex/mini, or root zodvex)
 * calls setZodFactory() at module load time before any getZ() call.
 * In tests, vitest setup calls setZodFactory() before test files run.
 */
export function getZ(): ZodFactory {
  if (!_z) {
    throw new Error(
      'zodvex: No Zod namespace configured. Import from zodvex/core or zodvex/mini before using zodvex APIs.'
    )
  }
  return _z
}
