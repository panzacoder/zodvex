import type {
  GenericId,
  VAny,
  VArray,
  VBoolean,
  VFloat64,
  VId,
  VInt64,
  VLiteral,
  VNull,
  VObject,
  VOptional,
  VRecord,
  VString,
  VUnion
} from 'convex/values'
import type {
  $ZodType,
  $ZodOptional,
  $ZodNullable,
  $ZodDefault,
  $ZodObject,
  $ZodArray,
  $ZodUnion,
  $ZodRecord,
  $ZodDate,
  $ZodCodec,
  $ZodString,
  $ZodNumber,
  $ZodBoolean,
  $ZodNull,
  $ZodBigInt,
  $ZodAny,
  $ZodUnknown,
  $ZodLiteral,
  $ZodEnum,
  $ZodShape,
  infer as zinfer
} from 'zod/v4/core'
import type { ZodvexWireSchema } from '../types'

// ============================================================================
// WireInfer - Extract wire types from Zod schemas for Convex document types
// ============================================================================

/**
 * Checks if a Zod field type represents an optional field (ZodOptional or ZodDefault).
 * Used to determine which fields should use TypeScript's optional property syntax (?:).
 */
type IsOptionalField<Z> =
  Z extends $ZodOptional<any> ? true : Z extends $ZodDefault<any> ? true : false

/**
 * Unwraps ZodOptional and ZodDefault to get the inner type.
 * For ZodOptional<T> -> T
 * For ZodDefault<T> -> T
 * For other types -> Z (unchanged)
 *
 * Note: Returns the wire-inferred value directly, not a Zod type.
 * This is used in the context of WireInferObject where we need the
 * value type, not the schema type.
 */
type UnwrapOptionalValue<Z> =
  Z extends $ZodOptional<infer Inner extends $ZodType>
    ? WireInferValue<Inner>
    : Z extends $ZodDefault<infer Inner extends $ZodType>
      ? WireInferValue<Inner>
      : Z extends $ZodType
        ? WireInferValue<Z>
        : never

/**
 * Like WireInfer but doesn't add | undefined for optionals.
 * Used for extracting field value types in objects where optionality
 * is expressed via TypeScript's ?: syntax instead of | undefined.
 *
 * This distinction is critical for Convex's FieldTypeFromFieldPath:
 * - { email?: T } allows path extraction to work correctly
 * - { email: T | undefined } breaks path extraction because undefined
 *   doesn't extend GenericDocument (Record<string, Value>)
 *
 * Check order: codecs → wrappers → containers → primitives → fallback
 */
type WireInferValue<Z extends $ZodType> =
  // 1. Branded zodvex codecs (zx.date(), zx.codec(), etc.) — most common in zodvex
  Z extends { readonly [ZodvexWireSchema]: infer W extends $ZodType }
    ? zinfer<W>
    : // 2. Native Zod codecs
      Z extends $ZodCodec<infer Wire extends $ZodType, any>
      ? zinfer<Wire>
      : // 3. Wrappers — unwrap and recurse
        Z extends $ZodOptional<infer Inner extends $ZodType>
        ? WireInferValue<Inner>
        : Z extends $ZodNullable<infer Inner extends $ZodType>
          ? WireInferValue<Inner> | null
          : Z extends $ZodDefault<infer Inner extends $ZodType>
            ? WireInferValue<Inner>
            : // 4. Objects — recurse into shape
              Z extends $ZodObject<infer Shape extends $ZodShape>
              ? WireInferObject<Shape>
              : // 5. Containers
                Z extends $ZodArray<infer Element extends $ZodType>
                ? WireInferValue<Element>[]
                : Z extends $ZodUnion<infer Options extends readonly $ZodType[]>
                  ? WireInferValue<Options[number]>
                  : Z extends $ZodRecord<$ZodString, infer V extends $ZodType>
                    ? Record<string, WireInferValue<V>>
                    : // 6. z.date() fallback (should use zx.date() instead)
                      Z extends $ZodDate
                      ? number
                      : // 7. Primitives — use Zod's built-in inference
                        zinfer<Z>

/**
 * Builds an object type from a Zod shape using TypeScript's ?: syntax for optional fields.
 * This ensures Convex's FieldTypeFromFieldPath works correctly with nested paths.
 *
 * The key insight: Convex's path extraction checks `FieldValue extends GenericDocument`.
 * - With { email: T | undefined }, this check fails (undefined doesn't extend Record<string, Value>)
 * - With { email?: T }, the ?: is just syntax sugar and path extraction works correctly
 */
type WireInferObject<Shape extends $ZodShape> = {
  // Required fields (non-optional, non-default)
  [K in keyof Shape as IsOptionalField<Shape[K]> extends true
    ? never
    : K]: Shape[K] extends $ZodType ? WireInferValue<Shape[K]> : never
} & {
  // Optional fields with ?: syntax
  [K in keyof Shape as IsOptionalField<Shape[K]> extends true ? K : never]?: UnwrapOptionalValue<
    Shape[K]
  >
}

/**
 * Recursively extracts the wire/input type from a Zod schema.
 * For codecs (including zx.date()), uses the wire format type.
 * For objects, recursively processes each field using ?: for optional fields.
 * For other types, falls back to zinfer.
 *
 * This is critical for Convex's GenericDocument constraint - the document type
 * must reflect what's actually stored in the database (wire format), not the
 * runtime representation after decoding.
 *
 * Check order: codecs → wrappers → containers → primitives → fallback
 */
type WireInfer<Z extends $ZodType> =
  // 1. Branded zodvex codecs — most common in zodvex
  Z extends { readonly [ZodvexWireSchema]: infer W extends $ZodType }
    ? zinfer<W>
    : // 2. Native Zod codecs
      Z extends $ZodCodec<infer Wire extends $ZodType, any>
      ? zinfer<Wire>
      : // 3. Wrappers
        Z extends $ZodOptional<infer Inner extends $ZodType>
        ? WireInfer<Inner> | undefined
        : Z extends $ZodNullable<infer Inner extends $ZodType>
          ? WireInfer<Inner> | null
          : Z extends $ZodDefault<infer Inner extends $ZodType>
            ? WireInfer<Inner>
            : // 4. Objects
              Z extends $ZodObject<infer Shape extends $ZodShape>
              ? WireInferObject<Shape>
              : // 5. Containers
                Z extends $ZodArray<infer Element extends $ZodType>
                ? WireInferValue<Element>[]
                : Z extends $ZodUnion<infer Options extends readonly $ZodType[]>
                  ? WireInfer<Options[number]>
                  : Z extends $ZodRecord<$ZodString, infer V extends $ZodType>
                    ? Record<string, WireInferValue<V>>
                    : // 6. z.date() fallback
                      Z extends $ZodDate
                      ? number
                      : // 7. Primitives
                        zinfer<Z>

// Check if a type has the _tableName property added by zx.id() (or legacy zid())
type IsZid<T> = T extends { _tableName: infer _TableName extends string } ? true : false

// Extract table name from zx.id() type (via _tableName property)
type ExtractTableName<T> = T extends { _tableName: infer TableName } ? TableName : never

// Helper to map enum tuple to VLiteral validators tuple
// Based on convex-helpers approach which handles different lengths explicitly
// This avoids TypeScript recursion issues and provides better type inference
type EnumToLiteralsTuple<T extends readonly [string, ...string[]]> = T['length'] extends 1
  ? [VLiteral<T[0], 'required'>]
  : T['length'] extends 2
    ? [VLiteral<T[0], 'required'>, VLiteral<T[1], 'required'>]
    : [
        VLiteral<T[0], 'required'>,
        VLiteral<T[1], 'required'>,
        ...{
          [K in keyof T]: K extends '0' | '1'
            ? never
            : K extends keyof T
              ? VLiteral<T[K], 'required'>
              : never
        }[keyof T & number][]
      ]

export type ZodValidator = Record<string, $ZodType>

// Helper type to convert optional types to union with null for container elements
// This ensures we never produce VOptional which has "optional" constraint
type ConvexValidatorFromZodRequired<Z extends $ZodType> =
  Z extends $ZodOptional<infer T extends $ZodType>
    ? VUnion<WireInfer<T> | null, any[], 'required'>
    : ConvexValidatorFromZodBase<Z>

/**
 * Base type mapper that never produces VOptional.
 * Check order: codecs → id → primitives → containers → fallback
 */
type ConvexValidatorFromZodBase<Z extends $ZodType> =
  // 1. Branded zodvex codecs — extract wire schema and recurse
  Z extends { readonly [ZodvexWireSchema]: infer W extends $ZodType }
    ? ConvexValidatorFromZodBase<W>
    : // 2. Native Zod codecs — use input schema (wire format) for Convex
      Z extends $ZodCodec<infer A extends $ZodType, any>
      ? ConvexValidatorFromZodBase<A>
      : // 3. Convex IDs
        IsZid<Z> extends true
        ? ExtractTableName<Z> extends infer TableName extends string
          ? VId<GenericId<TableName>, 'required'>
          : VAny<'required'>
        : // 4. Common primitives
          Z extends $ZodString
          ? VString<zinfer<Z>, 'required'>
          : Z extends $ZodNumber
            ? VFloat64<zinfer<Z>, 'required'>
            : Z extends $ZodBoolean
              ? VBoolean<zinfer<Z>, 'required'>
              : Z extends $ZodNull
                ? VNull<null, 'required'>
                : // 5. Containers
                  Z extends $ZodArray<infer T extends $ZodType>
                  ? VArray<WireInfer<Z>, ConvexValidatorFromZodRequired<T>, 'required'>
                  : Z extends $ZodObject<infer T>
                    ? VObject<WireInfer<Z>, ConvexValidatorFromZodFieldsAuto<T>, 'required', string>
                    : Z extends $ZodUnion<infer T>
                      ? T extends readonly [$ZodType, $ZodType, ...$ZodType[]]
                        ? VUnion<WireInfer<Z>, any[], 'required'>
                        : never
                      : // 6. Literals and enums
                        Z extends $ZodLiteral<infer T>
                        ? VLiteral<T, 'required'>
                        : Z extends $ZodEnum<infer T>
                          ? T extends readonly [string, ...string[]]
                            ? T['length'] extends 1
                              ? VLiteral<T[0], 'required'>
                              : T['length'] extends 2
                                ? VUnion<
                                    T[number],
                                    [VLiteral<T[0], 'required'>, VLiteral<T[1], 'required'>],
                                    'required',
                                    never
                                  >
                                : VUnion<T[number], EnumToLiteralsTuple<T>, 'required', never>
                            : T extends Record<string, string | number>
                              ? VUnion<
                                  T[keyof T],
                                  Array<VLiteral<T[keyof T], 'required'>>,
                                  'required',
                                  never
                                >
                              : VUnion<string, any[], 'required', any>
                          : // 7. Less common types
                            Z extends $ZodRecord<$ZodString, infer V extends $ZodType>
                            ? VRecord<
                                Record<string, WireInfer<V>>,
                                VString<string, 'required'>,
                                ConvexValidatorFromZodRequired<V>,
                                'required',
                                string
                              >
                            : Z extends $ZodNullable<infer Inner extends $ZodType>
                              ? Inner extends $ZodOptional<infer InnerInner extends $ZodType>
                                ? VOptional<
                                    VUnion<
                                      WireInfer<InnerInner> | null,
                                      [
                                        ConvexValidatorFromZodBase<InnerInner>,
                                        VNull<null, 'required'>
                                      ],
                                      'required'
                                    >
                                  >
                                : VUnion<
                                    WireInfer<Inner> | null,
                                    [ConvexValidatorFromZodBase<Inner>, VNull<null, 'required'>],
                                    'required'
                                  >
                              : Z extends $ZodDate
                                ? VFloat64<number, 'required'>
                                : Z extends $ZodBigInt
                                  ? VInt64<zinfer<Z>, 'required'>
                                  : Z extends $ZodAny
                                    ? VAny<'required'>
                                    : Z extends $ZodUnknown
                                      ? VAny<'required'>
                                      : VAny<'required'>

/**
 * Main type mapper with constraint system.
 *
 * Check order optimized for zodvex usage patterns:
 * codecs → wrappers → id → common primitives → containers → rare types → fallback
 *
 * Codec and wrapper checks come first because zodvex fields commonly use
 * zx.date(), zx.id(), zx.codec() wrapped in .optional()/.nullable().
 * These types just unwrap and recurse — checking them first avoids
 * ~12 failed `extends` checks per codec field.
 */
export type ConvexValidatorFromZod<
  Z extends $ZodType,
  Constraint extends 'required' | 'optional' = 'required'
> = Z extends { readonly [ZodvexWireSchema]: infer W extends $ZodType } // 1. Branded zodvex codecs — extract wire schema and recurse
  ? ConvexValidatorFromZod<W, Constraint>
  : // 2. Native Zod codecs — use input schema (wire format) for Convex
    Z extends $ZodCodec<infer A extends $ZodType, any>
    ? ConvexValidatorFromZod<A, Constraint>
    : // 3. Wrappers — unwrap and recurse with appropriate constraints
      Z extends $ZodDefault<infer T extends $ZodType>
      ? ConvexValidatorFromZod<T, Constraint>
      : Z extends $ZodOptional<infer T extends $ZodType>
        ? T extends $ZodNullable<infer Inner extends $ZodType>
          ? VOptional<VUnion<WireInfer<Inner> | null, any[], 'required'>>
          : Constraint extends 'required'
            ? VUnion<WireInfer<T>, any[], 'required'>
            : VOptional<ConvexValidatorFromZod<T, 'required'>>
        : Z extends $ZodNullable<infer T extends $ZodType>
          ? VUnion<WireInfer<T> | null, any[], Constraint>
          : // 4. Convex IDs
            IsZid<Z> extends true
            ? ExtractTableName<Z> extends infer TableName extends string
              ? VId<GenericId<TableName>, Constraint>
              : VAny<'required'>
            : // 5. Common primitives
              Z extends $ZodString
              ? VString<zinfer<Z>, Constraint>
              : Z extends $ZodNumber
                ? VFloat64<zinfer<Z>, Constraint>
                : Z extends $ZodBoolean
                  ? VBoolean<zinfer<Z>, Constraint>
                  : Z extends $ZodNull
                    ? VNull<null, Constraint>
                    : // 6. Containers
                      Z extends $ZodArray<infer T extends $ZodType>
                      ? VArray<WireInfer<Z>, ConvexValidatorFromZodRequired<T>, Constraint>
                      : Z extends $ZodObject<infer T>
                        ? VObject<
                            WireInfer<Z>,
                            ConvexValidatorFromZodFields<T, 'required'>,
                            Constraint,
                            string
                          >
                        : Z extends $ZodUnion<infer T>
                          ? T extends readonly [$ZodType, $ZodType, ...$ZodType[]]
                            ? VUnion<WireInfer<Z>, any[], Constraint>
                            : never
                          : // 7. Literals and enums
                            Z extends $ZodLiteral<infer T>
                            ? VLiteral<T, Constraint>
                            : Z extends $ZodEnum<infer T>
                              ? T extends readonly [string, ...string[]]
                                ? T['length'] extends 1
                                  ? VLiteral<T[0], Constraint>
                                  : T['length'] extends 2
                                    ? VUnion<
                                        T[number],
                                        [VLiteral<T[0], 'required'>, VLiteral<T[1], 'required'>],
                                        Constraint,
                                        never
                                      >
                                    : VUnion<T[number], EnumToLiteralsTuple<T>, Constraint, never>
                                : T extends Record<string, string | number>
                                  ? VUnion<
                                      T[keyof T],
                                      Array<VLiteral<T[keyof T], 'required'>>,
                                      Constraint,
                                      never
                                    >
                                  : VUnion<string, any[], Constraint, any>
                              : // 8. Less common types
                                Z extends $ZodRecord<$ZodString, infer V extends $ZodType>
                                ? VRecord<
                                    Record<string, WireInfer<V>>,
                                    VString<string, 'required'>,
                                    ConvexValidatorFromZodRequired<V>,
                                    Constraint,
                                    string
                                  >
                                : Z extends $ZodDate
                                  ? VFloat64<number, Constraint>
                                  : Z extends $ZodBigInt
                                    ? VInt64<zinfer<Z>, Constraint>
                                    : // 9. Catch-alls
                                      Z extends $ZodAny
                                      ? VAny<'required'>
                                      : Z extends $ZodUnknown
                                        ? VAny<'required'>
                                        : VAny<'required'>

type ConvexValidatorFromZodFields<
  T extends { [key: string]: any },
  Constraint extends 'required' | 'optional' = 'required'
> = {
  [K in keyof T]: T[K] extends $ZodType
    ? ConvexValidatorFromZod<T[K], Constraint>
    : VAny<'required'>
}

/**
 * Auto-detect optional fields and apply appropriate constraints.
 * Simplified: only checks IsOptionalField (ZodOptional | ZodDefault)
 * to determine the constraint. ConvexValidatorFromZod handles all
 * type-specific logic internally.
 */
export type ConvexValidatorFromZodFieldsAuto<T extends { [key: string]: any }> = {
  [K in keyof T]: T[K] extends $ZodType
    ? ConvexValidatorFromZod<T[K], IsOptionalField<T[K]> extends true ? 'optional' : 'required'>
    : VAny<'required'>
}
