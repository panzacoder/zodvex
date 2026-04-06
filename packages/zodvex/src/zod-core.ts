// Central re-export of zod/v4/core types and functions.
// zodvex uses these for instanceof checks and standalone parse/encode operations.
// Schema CONSTRUCTION still uses 'zod' (full) — see zx.ts, utils.ts.
//
// Per Zod's library author guidance (https://zod.dev/library-authors),
// importing from 'zod/v4/core' ensures zodvex works with both zod and zod/mini.
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
  type $strip,
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
  // Global metadata registry (mini-compatible alternative to .description getter)
  globalRegistry,
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
