// Central re-export of zod/v4/core types and functions.
// zodvex uses these for instanceof checks and standalone parse/encode operations.
// Schema CONSTRUCTION still uses 'zod' (full) — see zx.ts, utils.ts.
//
// Per Zod's library author guidance (https://zod.dev/library-authors),
// importing from 'zod/v4/core' ensures zodvex works with both zod and zod/mini.
export {
  // Base types
  $ZodType,
  $ZodString,
  $ZodNumber,
  $ZodBoolean,
  $ZodBigInt,
  $ZodDate,
  $ZodNull,
  $ZodUndefined,
  $ZodAny,
  $ZodUnknown,
  $ZodNaN,
  $ZodVoid,
  $ZodNever,
  $ZodSymbol,
  // Compound types
  $ZodObject,
  $ZodArray,
  $ZodTuple,
  $ZodUnion,
  $ZodDiscriminatedUnion,
  $ZodEnum,
  $ZodLiteral,
  $ZodRecord,
  // Wrappers
  $ZodOptional,
  $ZodNullable,
  $ZodDefault,
  $ZodPrefault,
  $ZodNonOptional,
  $ZodReadonly,
  // Transform/pipe
  $ZodTransform,
  $ZodPipe,
  $ZodCodec,
  $ZodLazy,
  $ZodCustom,
  // File
  $ZodFile,
  // Errors
  $ZodError,
  // Standalone parse/encode functions
  parse,
  safeParse,
  encode,
  decode,
  // Type utilities
  type infer,
  type input,
  type output,
  // Internals for advanced type checking
  type $ZodTypeDef,
  type $ZodTypeInternals
} from 'zod/v4/core'
