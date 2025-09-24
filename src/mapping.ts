import {
  type Validator,
  v,
  type GenericId,
  type VString,
  type VFloat64,
  type VInt64,
  type VBoolean,
  type VNull,
  type VAny,
  type VObject,
  type VArray,
  type VUnion,
  type VLiteral,
  type VOptional,
  type VRecord,
  type VId,
  type VBytes,
  type PropertyValidators,
  type GenericValidator
} from 'convex/values'
import { z } from 'zod'
import { registryHelpers } from './ids'
import { findBaseCodec } from './registry'

export type ZodValidator = Record<string, z.ZodTypeAny>

// Helper to check if a schema is a Zid
function isZid<T extends string>(schema: z.ZodType): boolean {
  // Check our metadata registry for ConvexId marker
  const metadata = registryHelpers.getMetadata(schema)
  return (
    metadata?.isConvexId === true &&
    metadata?.tableName &&
    typeof metadata.tableName === 'string'
  )
}

// Helper type to convert optional types to union with null for container elements
// This ensures we never produce VOptional which has "optional" constraint
type ConvexValidatorFromZodRequired<Z extends z.ZodTypeAny> =
  Z extends z.ZodOptional<infer T extends z.ZodTypeAny>
    ? VUnion<
        z.infer<T> | null,
        [ConvexValidatorFromZodBase<T>, VNull<null, 'required'>],
        'required'
      >
    : ConvexValidatorFromZodBase<Z>

// Base type mapper that never produces VOptional
type ConvexValidatorFromZodBase<Z extends z.ZodTypeAny> = Z extends z.ZodString
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
              ? VArray<
                  z.infer<Z>,
                  ConvexValidatorFromZodRequired<T>,
                  'required'
                >
              : Z extends z.ZodObject<infer T>
                ? VObject<
                    z.infer<Z>,
                    ConvexValidatorFromZodFieldsAuto<T>,
                    'required',
                    string
                  >
                : Z extends z.ZodUnion<infer T>
                  ? T extends readonly [
                      z.ZodTypeAny,
                      z.ZodTypeAny,
                      ...z.ZodTypeAny[]
                    ]
                    ? VUnion<
                        z.infer<Z>,
                        [
                          ConvexValidatorFromZodRequired<T[0]>,
                          ConvexValidatorFromZodRequired<T[1]>,
                          ...Array<ConvexValidatorFromZodRequired<T[number]>>
                        ],
                        'required'
                      >
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
                                [
                                  VLiteral<T[0], 'required'>,
                                  VLiteral<T[1], 'required'>
                                ],
                                'required'
                              >
                            : VUnion<
                                T[number],
                                [
                                  VLiteral<T[0], 'required'>,
                                  VLiteral<T[1], 'required'>,
                                  ...Array<VLiteral<T[number], 'required'>>
                                ],
                                'required'
                              >
                        : never
                      : Z extends z.ZodRecord<
                            z.ZodString,
                            infer V extends z.ZodTypeAny
                          >
                        ? VRecord<
                            Record<string, z.infer<V>>,
                            VString<string, 'required'>,
                            ConvexValidatorFromZodRequired<V>,
                            'required',
                            string
                          >
                        : Z extends z.ZodNullable<
                              infer Inner extends z.ZodTypeAny
                            >
                          ? Inner extends z.ZodOptional<
                              infer InnerInner extends z.ZodTypeAny
                            >
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
                                [
                                  ConvexValidatorFromZodBase<Inner>,
                                  VNull<null, 'required'>
                                ],
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
          ? VOptional<
              VUnion<
                z.infer<Inner> | null,
                [
                  ConvexValidatorFromZod<Inner, 'required'>,
                  VNull<null, 'required'>
                ],
                'required'
              >
            >
          : Constraint extends 'required'
            ? VUnion<
                z.infer<T> | null,
                [
                  ConvexValidatorFromZod<T, 'required'>,
                  VNull<null, 'required'>
                ],
                'required'
              >
            : VOptional<ConvexValidatorFromZod<T, 'required'>>
        : Z extends z.ZodNullable<infer T extends z.ZodTypeAny>
          ? VUnion<
              z.infer<T> | null,
              [ConvexValidatorFromZod<T, 'required'>, VNull<null, 'required'>],
              Constraint
            >
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
                        ? VArray<
                            z.infer<Z>,
                            ConvexValidatorFromZodRequired<T>,
                            Constraint
                          >
                        : Z extends z.ZodObject<infer T>
                          ? VObject<
                              z.infer<Z>,
                              ConvexValidatorFromZodFields<T, 'required'>,
                              Constraint,
                              string
                            >
                          : Z extends z.ZodUnion<infer T>
                            ? T extends readonly [
                                z.ZodTypeAny,
                                z.ZodTypeAny,
                                ...z.ZodTypeAny[]
                              ]
                              ? VUnion<
                                  z.infer<Z>,
                                  [
                                    ConvexValidatorFromZodRequired<T[0]>,
                                    ConvexValidatorFromZodRequired<T[1]>,
                                    ...Array<
                                      ConvexValidatorFromZodRequired<T[number]>
                                    >
                                  ],
                                  Constraint
                                >
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
                                          Constraint
                                        >
                                      : VUnion<
                                          T[number],
                                          [
                                            VLiteral<T[0], 'required'>,
                                            VLiteral<T[1], 'required'>,
                                            ...Array<
                                              VLiteral<T[number], 'required'>
                                            >
                                          ],
                                          Constraint
                                        >
                                  : never
                                : Z extends z.ZodRecord<
                                      z.ZodString,
                                      infer V extends z.ZodTypeAny
                                    >
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
type ConvexValidatorFromZodFieldsAuto<T extends { [key: string]: any }> = {
  [K in keyof T]: T[K] extends z.ZodOptional<any>
    ? ConvexValidatorFromZod<T[K], 'optional'>
    : T[K] extends z.ZodTypeAny
      ? ConvexValidatorFromZod<T[K], 'required'>
      : VAny<'required'>
}

// union helpers
export function makeUnion(members: any[]): any {
  const nonNull = members.filter(Boolean)
  if (nonNull.length === 0) return v.any()
  if (nonNull.length === 1) return nonNull[0]
  return v.union(nonNull[0], nonNull[1], ...nonNull.slice(2))
}

export function getObjectShape(obj: any): Record<string, any> {
  // Use public API .shape property for ZodObject
  if (obj instanceof z.ZodObject) {
    return obj.shape
  }
  // Fallback for edge cases
  if (obj && typeof obj === 'object' && typeof obj.shape === 'object') {
    return obj.shape as Record<string, any>
  }
  return {}
}

// Internal conversion function using ZodType with def.type detection
function zodToConvexInternal<Z extends z.ZodTypeAny>(
  zodValidator: Z
): ConvexValidatorFromZod<Z, 'required'> {
  // Check for default and optional wrappers
  let actualValidator = zodValidator
  let isOptional = false
  let defaultValue: any = undefined
  let hasDefault = false

  // Handle ZodDefault (which wraps ZodOptional when using .optional().default())
  if (zodValidator instanceof z.ZodDefault) {
    hasDefault = true
    // defaultValue is a property in def, not a function
    defaultValue = (zodValidator as any).def?.defaultValue
    actualValidator = (zodValidator as any).def?.innerType as Z
  }

  // Check for optional (may be wrapped inside ZodDefault)
  if (actualValidator instanceof z.ZodOptional) {
    isOptional = true
    actualValidator = actualValidator.unwrap() as Z

    // If the unwrapped type is ZodDefault, handle it here
    if (actualValidator instanceof z.ZodDefault) {
      hasDefault = true
      defaultValue = (actualValidator as any).def?.defaultValue
      actualValidator = (actualValidator as any).def?.innerType as Z
    }
  }

  let convexValidator: GenericValidator

  // Check for Zid first (special case)
  if (isZid(actualValidator)) {
    const metadata = registryHelpers.getMetadata(actualValidator)
    const tableName = metadata?.tableName || 'unknown'
    convexValidator = v.id(tableName)
  } else {
    // Use the def.type property for robust type detection
    const defType = (actualValidator as any).def?.type

    switch (defType) {
      case 'string':
        // This catches ZodString and ALL string format types (email, url, uuid, etc.)
        convexValidator = v.string()
        break
      case 'number':
        convexValidator = v.float64()
        break
      case 'bigint':
        convexValidator = v.int64()
        break
      case 'boolean':
        convexValidator = v.boolean()
        break
      case 'date':
        convexValidator = v.float64() // Dates are stored as timestamps in Convex
        break
      case 'null':
        convexValidator = v.null()
        break
      case 'nan':
        convexValidator = v.float64()
        break
      case 'array': {
        // Use classic API: ZodArray has .element property
        if (actualValidator instanceof z.ZodArray) {
          const element = (actualValidator as any).element
          if (element && element instanceof z.ZodType) {
            convexValidator = v.array(zodToConvexInternal(element))
          } else {
            convexValidator = v.array(v.any())
          }
        } else {
          convexValidator = v.array(v.any())
        }
        break
      }
      case 'object': {
        // Use classic API: ZodObject has .shape property
        if (actualValidator instanceof z.ZodObject) {
          const shape = actualValidator.shape
          const convexShape: PropertyValidators = {}
          for (const [key, value] of Object.entries(shape)) {
            if (value && value instanceof z.ZodType) {
              convexShape[key] = zodToConvexInternal(value)
            }
          }
          convexValidator = v.object(convexShape)
        } else {
          convexValidator = v.object({})
        }
        break
      }
      case 'union': {
        // Use classic API: ZodUnion has .options property
        if (actualValidator instanceof z.ZodUnion) {
          const options = (actualValidator as any).options
          if (options && Array.isArray(options) && options.length > 0) {
            if (options.length === 1) {
              convexValidator = zodToConvexInternal(options[0])
            } else {
              // Convert each option recursively
              const convexOptions = options.map((opt: any) =>
                zodToConvexInternal(opt)
              ) as Validator<any, 'required', any>[]
              if (convexOptions.length >= 2) {
                convexValidator = v.union(
                  convexOptions[0]!,
                  convexOptions[1]!,
                  ...convexOptions.slice(2)
                )
              } else {
                convexValidator = v.any()
              }
            }
          } else {
            convexValidator = v.any()
          }
        } else {
          convexValidator = v.any()
        }
        break
      }
      case 'discriminatedUnion': {
        const options =
          (actualValidator as any).def?.options ||
          (actualValidator as any).def?.optionsMap?.values()
        if (options) {
          const opts = Array.isArray(options) ? options : Array.from(options)
          if (opts.length >= 2) {
            const convexOptions = opts.map((opt: any) =>
              zodToConvexInternal(opt)
            ) as Validator<any, 'required', any>[]
            convexValidator = v.union(
              convexOptions[0]!,
              convexOptions[1]!,
              ...convexOptions.slice(2)
            )
          } else {
            convexValidator = v.any()
          }
        } else {
          convexValidator = v.any()
        }
        break
      }
      case 'literal': {
        // Use classic API: ZodLiteral has .value property
        if (actualValidator instanceof z.ZodLiteral) {
          const literalValue = (actualValidator as any).value
          if (literalValue !== undefined && literalValue !== null) {
            convexValidator = v.literal(literalValue)
          } else {
            convexValidator = v.any()
          }
        } else {
          convexValidator = v.any()
        }
        break
      }
      case 'enum': {
        // Use classic API: ZodEnum has .options property
        if (actualValidator instanceof z.ZodEnum) {
          const options = (actualValidator as any).options
          if (options && Array.isArray(options) && options.length > 0) {
            // Filter out undefined/null and convert to Convex validators
            const validLiterals = options
              .filter((opt: any) => opt !== undefined && opt !== null)
              .map((opt: any) => v.literal(opt))

            if (validLiterals.length === 1) {
              convexValidator = validLiterals[0]!
            } else if (validLiterals.length >= 2) {
              convexValidator = v.union(
                validLiterals[0]!,
                validLiterals[1]!,
                ...validLiterals.slice(2)
              )
            } else {
              convexValidator = v.any()
            }
          } else {
            convexValidator = v.any()
          }
        } else {
          convexValidator = v.any()
        }
        break
      }
      case 'record': {
        // Use classic API: ZodRecord has .valueType property
        if (actualValidator instanceof z.ZodRecord) {
          const valueType = (actualValidator as any).valueType
          if (valueType && valueType instanceof z.ZodType) {
            // First check if the Zod value type is optional before conversion
            const isZodOptional =
              valueType instanceof z.ZodOptional ||
              valueType instanceof z.ZodDefault ||
              (valueType instanceof z.ZodDefault &&
                valueType.def.innerType instanceof z.ZodOptional)

            if (isZodOptional) {
              // For optional record values, we need to handle this specially
              let innerType: z.ZodTypeAny
              let recordDefaultValue: any = undefined
              let recordHasDefault = false

              if (valueType instanceof z.ZodDefault) {
                // Handle ZodDefault wrapper
                recordHasDefault = true
                recordDefaultValue = valueType.def.defaultValue
                const innerFromDefault = valueType.def.innerType
                if (innerFromDefault instanceof z.ZodOptional) {
                  innerType = innerFromDefault.unwrap() as z.ZodTypeAny
                } else {
                  innerType = innerFromDefault as z.ZodTypeAny
                }
              } else if (valueType instanceof z.ZodOptional) {
                // Direct ZodOptional
                innerType = valueType.unwrap() as z.ZodTypeAny
              } else {
                // Shouldn't happen based on isZodOptional check
                innerType = valueType as z.ZodTypeAny
              }

              // Convert the inner type to Convex and wrap in union with null
              const innerConvex = zodToConvexInternal(innerType)
              const unionValidator = v.union(innerConvex, v.null())

              // Add default metadata if present
              if (recordHasDefault) {
                ;(unionValidator as any)._zodDefault = recordDefaultValue
              }

              convexValidator = v.record(v.string(), unionValidator)
            } else {
              // Non-optional values can be converted normally
              convexValidator = v.record(
                v.string(),
                zodToConvexInternal(valueType)
              )
            }
          } else {
            convexValidator = v.record(v.string(), v.any())
          }
        } else {
          convexValidator = v.record(v.string(), v.any())
        }
        break
      }
      case 'transform':
      case 'pipe': {
        // Check for registered codec first
        const codec = findBaseCodec(actualValidator)
        if (codec) {
          convexValidator = codec.toValidator(actualValidator)
        } else {
          // Check for brand metadata
          const metadata = registryHelpers.getMetadata(actualValidator)
          if (metadata?.brand && metadata?.originalSchema) {
            // For branded types created by our zBrand function, use the original schema
            convexValidator = zodToConvexInternal(metadata.originalSchema)
          } else {
            // For non-registered transforms, return v.any()
            convexValidator = v.any()
          }
        }
        break
      }
      case 'nullable': {
        // Handle nullable schemas by creating a union with null
        if (actualValidator instanceof z.ZodNullable) {
          const innerSchema = actualValidator.unwrap()
          if (innerSchema && innerSchema instanceof z.ZodType) {
            // Check if the inner schema is optional
            if (innerSchema instanceof z.ZodOptional) {
              // For nullable(optional(T)), we want optional(union(T, null))
              const innerInnerSchema = innerSchema.unwrap()
              const innerInnerValidator = zodToConvexInternal(
                innerInnerSchema as z.ZodType
              )
              convexValidator = v.union(innerInnerValidator, v.null())
              isOptional = true // Mark as optional so it gets wrapped later
            } else {
              const innerValidator = zodToConvexInternal(innerSchema)
              convexValidator = v.union(innerValidator, v.null())
            }
          } else {
            convexValidator = v.any()
          }
        } else {
          convexValidator = v.any()
        }
        break
      }
      case 'tuple': {
        // Handle tuple types as objects with numeric keys
        if (actualValidator instanceof z.ZodTuple) {
          const items = (actualValidator as any).def?.items as
            | z.ZodTypeAny[]
            | undefined
          if (items && items.length > 0) {
            const convexShape: PropertyValidators = {}
            items.forEach((item, index) => {
              convexShape[`_${index}`] = zodToConvexInternal(item)
            })
            convexValidator = v.object(convexShape)
          } else {
            convexValidator = v.object({})
          }
        } else {
          convexValidator = v.object({})
        }
        break
      }
      case 'lazy': {
        // Handle lazy schemas by resolving them
        if (actualValidator instanceof z.ZodLazy) {
          try {
            const getter = (actualValidator as any).def?.getter
            if (getter) {
              const resolvedSchema = getter()
              if (resolvedSchema && resolvedSchema instanceof z.ZodType) {
                convexValidator = zodToConvexInternal(resolvedSchema)
              } else {
                convexValidator = v.any()
              }
            } else {
              convexValidator = v.any()
            }
          } catch {
            // If resolution fails, fall back to 'any'
            convexValidator = v.any()
          }
        } else {
          convexValidator = v.any()
        }
        break
      }
      case 'any':
        // Handle z.any() directly
        convexValidator = v.any()
        break
      case 'unknown':
        // Handle z.unknown() as any
        convexValidator = v.any()
        break
      case 'undefined':
      case 'void':
      case 'never':
        // These types don't have good Convex equivalents
        convexValidator = v.any()
        break
      case 'intersection':
        // Can't properly handle intersections
        convexValidator = v.any()
        break
      default:
        // For any unrecognized def.type, return v.any()
        // No instanceof fallbacks - keep it simple and performant
        convexValidator = v.any()
        break
    }
  }

  // For optional fields, always use v.optional()
  const finalValidator = isOptional
    ? v.optional(convexValidator)
    : convexValidator

  // Add metadata if there's a default value
  if (
    hasDefault &&
    typeof finalValidator === 'object' &&
    finalValidator !== null
  ) {
    ;(finalValidator as any)._zodDefault = defaultValue
  }

  return finalValidator as ConvexValidatorFromZod<Z, 'required'>
}

export function zodToConvex<Z extends z.ZodTypeAny | ZodValidator>(
  zod: Z
): Z extends z.ZodTypeAny
  ? ConvexValidatorFromZod<Z, 'required'>
  : Z extends ZodValidator
    ? ConvexValidatorFromZodFieldsAuto<Z>
    : never {
  if (typeof zod === 'object' && zod !== null && !(zod instanceof z.ZodType)) {
    return zodToConvexFields(zod as ZodValidator) as any
  }

  return zodToConvexInternal(zod as z.ZodTypeAny) as any
}

export function zodToConvexFields<Z extends ZodValidator | z.ZodRawShape>(
  zod: Z
) {
  return Object.fromEntries(
    Object.entries(zod).map(([k, v]) => [
      k,
      zodToConvexInternal(v as z.ZodTypeAny)
    ])
  ) as ConvexValidatorFromZodFieldsAuto<Z>
}
