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
import { z } from 'zod'
import type { ZodvexWireSchema } from '../types'

// ============================================================================
// WireInfer - Extract wire types from Zod schemas for Convex document types
// ============================================================================

/**
 * Checks if a Zod field type represents an optional field (ZodOptional or ZodDefault).
 * Used to determine which fields should use TypeScript's optional property syntax (?:).
 */
type IsOptionalField<Z> = Z extends z.ZodOptional<any>
  ? true
  : Z extends z.ZodDefault<any>
    ? true
    : false

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
type UnwrapOptionalValue<Z> = Z extends z.ZodOptional<infer Inner extends z.ZodTypeAny>
  ? WireInferValue<Inner>
  : Z extends z.ZodDefault<infer Inner extends z.ZodTypeAny>
    ? WireInferValue<Inner>
    : Z extends z.ZodTypeAny
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
 */
type WireInferValue<Z extends z.ZodTypeAny> =
  // Handle branded zodvex codecs (zx.date(), zx.codec(), etc.)
  Z extends { readonly [ZodvexWireSchema]: infer W extends z.ZodTypeAny }
    ? z.infer<W>
    : // Handle native Zod codecs
      Z extends z.ZodCodec<infer Wire extends z.ZodTypeAny, any>
      ? z.infer<Wire>
      : // Recursively process objects to handle nested codecs
        // Uses the same ?: pattern for nested optional fields
        Z extends z.ZodObject<infer Shape extends z.ZodRawShape>
        ? WireInferObject<Shape>
        : // Handle optionals - DON'T add | undefined here, let ?: handle it
          Z extends z.ZodOptional<infer Inner extends z.ZodTypeAny>
          ? WireInferValue<Inner>
          : // Handle nullables - DO add | null since this is about value, not presence
            Z extends z.ZodNullable<infer Inner extends z.ZodTypeAny>
            ? WireInferValue<Inner> | null
            : // Handle defaults - unwrap to inner type
              Z extends z.ZodDefault<infer Inner extends z.ZodTypeAny>
              ? WireInferValue<Inner>
              : // Handle arrays
                Z extends z.ZodArray<infer Element extends z.ZodTypeAny>
                ? WireInferValue<Element>[]
                : // Handle unions
                  Z extends z.ZodUnion<infer Options extends readonly z.ZodTypeAny[]>
                  ? WireInferValue<Options[number]>
                  : // Handle records
                    Z extends z.ZodRecord<z.ZodString, infer V extends z.ZodTypeAny>
                    ? Record<string, WireInferValue<V>>
                    : // Handle z.date() - maps to number for type inference only.
                      // IMPORTANT: z.date() does not work at runtime (use zx.date()).
                      Z extends z.ZodDate
                      ? number
                      : // Fallback to regular inference for primitives
                        z.infer<Z>

/**
 * Builds an object type from a Zod shape using TypeScript's ?: syntax for optional fields.
 * This ensures Convex's FieldTypeFromFieldPath works correctly with nested paths.
 *
 * The key insight: Convex's path extraction checks `FieldValue extends GenericDocument`.
 * - With { email: T | undefined }, this check fails (undefined doesn't extend Record<string, Value>)
 * - With { email?: T }, the ?: is just syntax sugar and path extraction works correctly
 */
type WireInferObject<Shape extends z.ZodRawShape> = {
  // Required fields (non-optional, non-default)
  [K in keyof Shape as IsOptionalField<Shape[K]> extends true
    ? never
    : K]: Shape[K] extends z.ZodTypeAny ? WireInferValue<Shape[K]> : never
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
 * For other types, falls back to z.infer.
 *
 * This is critical for Convex's GenericDocument constraint - the document type
 * must reflect what's actually stored in the database (wire format), not the
 * runtime representation after decoding.
 */
type WireInfer<Z extends z.ZodTypeAny> =
  // Handle branded zodvex codecs (zx.date(), zx.codec(), etc.)
  Z extends { readonly [ZodvexWireSchema]: infer W extends z.ZodTypeAny }
    ? z.infer<W>
    : // Handle native Zod codecs
      Z extends z.ZodCodec<infer Wire extends z.ZodTypeAny, any>
      ? z.infer<Wire>
      : // Recursively process objects to handle nested codecs
        // Uses ?: for optional fields to maintain Convex path extraction compatibility
        Z extends z.ZodObject<infer Shape extends z.ZodRawShape>
        ? WireInferObject<Shape>
        : // Handle optionals - add | undefined for standalone optionals (not in object context)
          Z extends z.ZodOptional<infer Inner extends z.ZodTypeAny>
          ? WireInfer<Inner> | undefined
          : // Handle nullables
            Z extends z.ZodNullable<infer Inner extends z.ZodTypeAny>
            ? WireInfer<Inner> | null
            : // Handle defaults (unwrap to inner type)
              Z extends z.ZodDefault<infer Inner extends z.ZodTypeAny>
              ? WireInfer<Inner>
              : // Handle arrays
                Z extends z.ZodArray<infer Element extends z.ZodTypeAny>
                ? WireInferValue<Element>[]
                : // Handle unions
                  Z extends z.ZodUnion<infer Options extends readonly z.ZodTypeAny[]>
                  ? WireInfer<Options[number]>
                  : // Handle records
                    Z extends z.ZodRecord<z.ZodString, infer V extends z.ZodTypeAny>
                    ? Record<string, WireInferValue<V>>
                    : // Handle z.date() - maps to number for type inference only.
                      // IMPORTANT: z.date() does not work at runtime (use zx.date()).
                      Z extends z.ZodDate
                      ? number
                      : // Fallback to regular inference for primitives
                        z.infer<Z>

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

export type ZodValidator = Record<string, z.ZodTypeAny>

// Helper type to convert optional types to union with null for container elements
// This ensures we never produce VOptional which has "optional" constraint
type ConvexValidatorFromZodRequired<Z extends z.ZodTypeAny> = Z extends z.ZodOptional<
  infer T extends z.ZodTypeAny
>
  ? VUnion<WireInfer<T> | null, any[], 'required'>
  : ConvexValidatorFromZodBase<Z>

// Base type mapper that never produces VOptional
type ConvexValidatorFromZodBase<Z extends z.ZodTypeAny> =
  // Check for zid types first (by _tableName property)
  IsZid<Z> extends true
    ? ExtractTableName<Z> extends infer TableName extends string
      ? VId<GenericId<TableName>, 'required'>
      : VAny<'required'>
    : Z extends z.ZodString
      ? VString<z.infer<Z>, 'required'>
      : Z extends z.ZodNumber
        ? VFloat64<z.infer<Z>, 'required'>
        : Z extends z.ZodDate
          ? VFloat64<number, 'required'>
          : Z extends z.ZodBigInt
            ? VInt64<z.infer<Z>, 'required'>
            : Z extends z.ZodBoolean
              ? VBoolean<z.infer<Z>, 'required'>
              : Z extends z.ZodNull
                ? VNull<null, 'required'>
                : Z extends z.ZodArray<infer T extends z.ZodTypeAny>
                  ? VArray<WireInfer<Z>, ConvexValidatorFromZodRequired<T>, 'required'>
                  : Z extends z.ZodObject<infer T>
                    ? VObject<WireInfer<Z>, ConvexValidatorFromZodFieldsAuto<T>, 'required', string>
                    : Z extends z.ZodUnion<infer T>
                      ? T extends readonly [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]
                        ? VUnion<WireInfer<Z>, any[], 'required'>
                        : never
                      : Z extends z.ZodLiteral<infer T>
                        ? VLiteral<T, 'required'>
                        : Z extends z.ZodEnum<infer T>
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
                          : Z extends z.ZodRecord<z.ZodString, infer V extends z.ZodTypeAny>
                            ? VRecord<
                                Record<string, WireInfer<V>>,
                                VString<string, 'required'>,
                                ConvexValidatorFromZodRequired<V>,
                                'required',
                                string
                              >
                            : Z extends z.ZodNullable<infer Inner extends z.ZodTypeAny>
                              ? Inner extends z.ZodOptional<infer InnerInner extends z.ZodTypeAny>
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
                              : Z extends z.ZodAny
                                ? VAny<'required'>
                                : Z extends z.ZodUnknown
                                  ? VAny<'required'>
                                  : Z extends {
                                        readonly [ZodvexWireSchema]: infer W extends z.ZodTypeAny
                                      }
                                    ? ConvexValidatorFromZodBase<W> // Extract wire schema from branded codec
                                    : Z extends z.ZodCodec<infer A extends z.ZodTypeAny, any>
                                      ? ConvexValidatorFromZodBase<A> // Use input schema (wire format) for Convex
                                      : VAny<'required'>

// Main type mapper with constraint system
export type ConvexValidatorFromZod<
  Z extends z.ZodTypeAny,
  Constraint extends 'required' | 'optional' = 'required'
> = Z extends z.ZodAny
  ? VAny<'required'>
  : Z extends z.ZodUnknown
    ? VAny<'required'>
    : Z extends z.ZodDefault<infer T extends z.ZodTypeAny>
      ? ConvexValidatorFromZod<T, Constraint>
      : Z extends z.ZodOptional<infer T extends z.ZodTypeAny>
        ? T extends z.ZodNullable<infer Inner extends z.ZodTypeAny>
          ? VOptional<VUnion<WireInfer<Inner> | null, any[], 'required'>>
          : Constraint extends 'required'
            ? VUnion<WireInfer<T>, any[], 'required'>
            : VOptional<ConvexValidatorFromZod<T, 'required'>>
        : Z extends z.ZodNullable<infer T extends z.ZodTypeAny>
          ? VUnion<WireInfer<T> | null, any[], Constraint>
          : IsZid<Z> extends true
            ? ExtractTableName<Z> extends infer TableName extends string
              ? VId<GenericId<TableName>, Constraint>
              : VAny<'required'>
            : Z extends z.ZodString
              ? VString<z.infer<Z>, Constraint>
              : Z extends z.ZodNumber
                ? VFloat64<z.infer<Z>, Constraint>
                : Z extends z.ZodDate
                  ? VFloat64<number, Constraint>
                  : Z extends z.ZodBigInt
                    ? VInt64<z.infer<Z>, Constraint>
                    : Z extends z.ZodBoolean
                      ? VBoolean<z.infer<Z>, Constraint>
                      : Z extends z.ZodNull
                        ? VNull<null, Constraint>
                        : Z extends z.ZodArray<infer T extends z.ZodTypeAny>
                          ? VArray<WireInfer<Z>, ConvexValidatorFromZodRequired<T>, Constraint>
                          : Z extends z.ZodObject<infer T>
                            ? VObject<
                                WireInfer<Z>,
                                ConvexValidatorFromZodFields<T, 'required'>,
                                Constraint,
                                string
                              >
                            : Z extends z.ZodUnion<infer T>
                              ? T extends readonly [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]
                                ? VUnion<WireInfer<Z>, any[], Constraint>
                                : never
                              : Z extends z.ZodLiteral<infer T>
                                ? VLiteral<T, Constraint>
                                : Z extends z.ZodEnum<infer T>
                                  ? T extends readonly [string, ...string[]]
                                    ? T['length'] extends 1
                                      ? VLiteral<T[0], Constraint>
                                      : T['length'] extends 2
                                        ? VUnion<
                                            T[number],
                                            [
                                              VLiteral<T[0], 'required'>,
                                              VLiteral<T[1], 'required'>
                                            ],
                                            Constraint,
                                            never
                                          >
                                        : VUnion<
                                            T[number],
                                            EnumToLiteralsTuple<T>,
                                            Constraint,
                                            never
                                          >
                                    : T extends Record<string, string | number>
                                      ? VUnion<
                                          T[keyof T],
                                          Array<VLiteral<T[keyof T], 'required'>>,
                                          Constraint,
                                          never
                                        >
                                      : VUnion<string, any[], Constraint, any>
                                  : Z extends z.ZodRecord<z.ZodString, infer V extends z.ZodTypeAny>
                                    ? VRecord<
                                        Record<string, WireInfer<V>>,
                                        VString<string, 'required'>,
                                        ConvexValidatorFromZodRequired<V>,
                                        Constraint,
                                        string
                                      >
                                    : Z extends {
                                          readonly [ZodvexWireSchema]: infer W extends z.ZodTypeAny
                                        }
                                      ? ConvexValidatorFromZod<W, Constraint> // Extract wire schema from branded codec
                                      : Z extends z.ZodCodec<infer A extends z.ZodTypeAny, any>
                                        ? ConvexValidatorFromZod<A, Constraint> // Use input schema (wire format) for Convex
                                        : VAny<'required'>

type ConvexValidatorFromZodFields<
  T extends { [key: string]: any },
  Constraint extends 'required' | 'optional' = 'required'
> = {
  [K in keyof T]: T[K] extends z.ZodTypeAny
    ? ConvexValidatorFromZod<T[K], Constraint>
    : VAny<'required'>
}

// Auto-detect optional fields and apply appropriate constraints
export type ConvexValidatorFromZodFieldsAuto<T extends { [key: string]: any }> = {
  [K in keyof T]: T[K] extends z.ZodOptional<any>
    ? ConvexValidatorFromZod<T[K], 'optional'>
    : T[K] extends z.ZodDefault<any>
      ? ConvexValidatorFromZod<T[K], 'optional'>
      : T[K] extends z.ZodNullable<any>
        ? ConvexValidatorFromZod<T[K], 'required'>
        : T[K] extends z.ZodEnum<any>
          ? ConvexValidatorFromZod<T[K], 'required'>
          : T[K] extends z.ZodTypeAny
            ? ConvexValidatorFromZod<T[K], 'required'>
            : VAny<'required'>
}
