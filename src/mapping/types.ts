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

// Check if a type has the _tableName property added by zid()
type IsZid<T> = T extends { _tableName: infer _TableName extends string } ? true : false

// Extract table name from zid type (via _tableName property)
type ExtractTableName<T> = T extends { _tableName: infer TableName } ? TableName : never

export type ZodValidator = Record<string, z.ZodTypeAny>

// Helper type to convert optional types to union with null for container elements
// This ensures we never produce VOptional which has "optional" constraint
type ConvexValidatorFromZodRequired<Z extends z.ZodTypeAny> = Z extends z.ZodOptional<
  infer T extends z.ZodTypeAny
>
  ? VUnion<z.infer<T> | null, any[], 'required'>
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
                  ? VArray<z.infer<Z>, ConvexValidatorFromZodRequired<T>, 'required'>
                  : Z extends z.ZodObject<infer T>
                    ? VObject<z.infer<Z>, ConvexValidatorFromZodFieldsAuto<T>, 'required', string>
                    : Z extends z.ZodUnion<infer T>
                      ? T extends readonly [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]
                        ? VUnion<z.infer<Z>, any[], 'required'>
                        : never
                      : Z extends z.ZodLiteral<infer T>
                        ? VLiteral<T, 'required'>
                        : Z extends z.ZodEnum<infer T>
                          ? T extends Readonly<Record<string, infer _V>>
                            ? T[keyof T] extends infer Values
                              ? VUnion<Values, any[], 'required'>
                              : never
                            : never
                          : Z extends z.ZodRecord<z.ZodString, infer V extends z.ZodTypeAny>
                            ? VRecord<
                                Record<string, z.infer<V>>,
                                VString<string, 'required'>,
                                ConvexValidatorFromZodRequired<V>,
                                'required',
                                string
                              >
                            : Z extends z.ZodNullable<infer Inner extends z.ZodTypeAny>
                              ? Inner extends z.ZodOptional<infer InnerInner extends z.ZodTypeAny>
                                ? VOptional<
                                    VUnion<
                                      z.infer<InnerInner> | null,
                                      [
                                        ConvexValidatorFromZodBase<InnerInner>,
                                        VNull<null, 'required'>
                                      ],
                                      'required'
                                    >
                                  >
                                : VUnion<
                                    z.infer<Inner> | null,
                                    [ConvexValidatorFromZodBase<Inner>, VNull<null, 'required'>],
                                    'required'
                                  >
                              : Z extends z.ZodAny
                                ? VAny<'required'>
                                : Z extends z.ZodUnknown
                                  ? VAny<'required'>
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
          ? VOptional<VUnion<z.infer<Inner> | null, any[], 'required'>>
          : Constraint extends 'required'
            ? VUnion<z.infer<T>, any[], 'required'>
            : VOptional<ConvexValidatorFromZod<T, 'required'>>
        : Z extends z.ZodNullable<infer T extends z.ZodTypeAny>
          ? VUnion<z.infer<T> | null, any[], Constraint>
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
                          ? VArray<z.infer<Z>, ConvexValidatorFromZodRequired<T>, Constraint>
                          : Z extends z.ZodObject<infer T>
                            ? VObject<
                                z.infer<Z>,
                                ConvexValidatorFromZodFields<T, 'required'>,
                                Constraint,
                                string
                              >
                            : Z extends z.ZodUnion<infer T>
                              ? T extends readonly [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]
                                ? VUnion<z.infer<Z>, any[], Constraint>
                                : never
                              : Z extends z.ZodLiteral<infer T>
                                ? VLiteral<T, Constraint>
                                : Z extends z.ZodEnum<infer T>
                                  ? T extends Readonly<Record<string, infer _V>>
                                    ? T[keyof T] extends infer Values
                                      ? VUnion<Values, any[], Constraint>
                                      : never
                                    : never
                                  : Z extends z.ZodRecord<z.ZodString, infer V extends z.ZodTypeAny>
                                    ? VRecord<
                                        Record<string, z.infer<V>>,
                                        VString<string, 'required'>,
                                        ConvexValidatorFromZodRequired<V>,
                                        Constraint,
                                        string
                                      >
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
