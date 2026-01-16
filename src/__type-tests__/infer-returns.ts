/**
 * Compile-time type tests for InferReturns (Issue #19)
 *
 * These assertions cause TypeScript errors if types don't match expectations.
 * This file is type-checked but not included in the bundle.
 */
import { z } from 'zod'
import type { InferReturns } from '../types'

// Test helper: causes TS error if assigned `any`
declare function expectNotAny<T>(value: 0 extends 1 & T ? never : T): void

// --- Simple schemas should infer correctly ---

declare const stringResult: InferReturns<z.ZodString>
expectNotAny(stringResult)

declare const objectResult: InferReturns<ReturnType<typeof z.object<{ name: z.ZodString }>>>
expectNotAny(objectResult)

// --- Union schemas: this is the Issue #19 bug ---
// If InferReturns bails to `any` for unions, these will fail

declare const unionSchema: z.ZodUnion<[z.ZodString, z.ZodNumber]>
declare const unionResult: InferReturns<typeof unionSchema>
// @ts-expect-error - If this errors with "unused directive", Result is `any` (the bug)
const _unionInvalid: typeof unionResult = { notStringOrNumber: true }

declare const literalUnionSchema: z.ZodUnion<[z.ZodLiteral<'a'>, z.ZodLiteral<'b'>]>
declare const literalUnionResult: InferReturns<typeof literalUnionSchema>
// @ts-expect-error - If this errors with "unused directive", Result is `any` (the bug)
const _literalInvalid: typeof literalUnionResult = { notAOrB: true }

// --- Complex/deeply nested schemas (stress tests for TS depth limits) ---
// These tests ensure removing bailouts doesn't cause "Type instantiation is
// excessively deep and possibly infinite" errors.

// Deeply nested object (5 levels)
const deeplyNestedSchema = z.object({
  level1: z.object({
    level2: z.object({
      level3: z.object({
        level4: z.object({
          level5: z.object({
            value: z.string()
          })
        })
      })
    })
  })
})
declare const deeplyNestedResult: InferReturns<typeof deeplyNestedSchema>
expectNotAny(deeplyNestedResult)

// Large discriminated union (10 variants) - common in real apps
const largeDiscriminatedUnion = z.discriminatedUnion('type', [
  z.object({ type: z.literal('variant1'), data: z.string() }),
  z.object({ type: z.literal('variant2'), count: z.number() }),
  z.object({ type: z.literal('variant3'), flag: z.boolean() }),
  z.object({ type: z.literal('variant4'), items: z.array(z.string()) }),
  z.object({ type: z.literal('variant5'), nested: z.object({ a: z.number() }) }),
  z.object({ type: z.literal('variant6'), opt: z.string().optional() }),
  z.object({ type: z.literal('variant7'), nullable: z.string().nullable() }),
  z.object({ type: z.literal('variant8'), tuple: z.tuple([z.string(), z.number()]) }),
  z.object({ type: z.literal('variant9'), record: z.record(z.string(), z.number()) }),
  z.object({ type: z.literal('variant10'), union: z.union([z.string(), z.number()]) })
])
declare const largeUnionResult: InferReturns<typeof largeDiscriminatedUnion>
expectNotAny(largeUnionResult)

// Nested unions (union containing objects with union fields)
const nestedUnionSchema = z.object({
  outer: z.union([
    z.object({
      kind: z.literal('a'),
      inner: z.union([z.literal('x'), z.literal('y')])
    }),
    z.object({
      kind: z.literal('b'),
      inner: z.union([z.literal('p'), z.literal('q')])
    })
  ])
})
declare const nestedUnionResult: InferReturns<typeof nestedUnionSchema>
expectNotAny(nestedUnionResult)

// Array of unions
const arrayOfUnionsSchema = z.array(
  z.union([
    z.object({ type: z.literal('item'), value: z.string() }),
    z.object({ type: z.literal('group'), children: z.array(z.string()) })
  ])
)
declare const arrayOfUnionsResult: InferReturns<typeof arrayOfUnionsSchema>
expectNotAny(arrayOfUnionsResult)

// Real-world pattern: API response with polymorphic data
const apiResponseSchema = z.object({
  success: z.boolean(),
  data: z
    .union([
      z.object({
        type: z.literal('user'),
        id: z.string(),
        name: z.string(),
        email: z.string().email(),
        roles: z.array(z.enum(['admin', 'user', 'guest']))
      }),
      z.object({
        type: z.literal('organization'),
        id: z.string(),
        name: z.string(),
        members: z.array(
          z.object({
            userId: z.string(),
            role: z.enum(['owner', 'admin', 'member'])
          })
        )
      }),
      z.object({
        type: z.literal('error'),
        code: z.number(),
        message: z.string(),
        details: z.record(z.string(), z.unknown()).optional()
      })
    ])
    .nullable(),
  meta: z.object({
    timestamp: z.number(),
    requestId: z.string()
  })
})
declare const apiResponseResult: InferReturns<typeof apiResponseSchema>
expectNotAny(apiResponseResult)

// Recursive-like pattern (not truly recursive, but deep)
const treeNodeSchema = z.object({
  id: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
  children: z.array(
    z.object({
      id: z.string(),
      value: z.union([z.string(), z.number(), z.boolean()]),
      children: z.array(
        z.object({
          id: z.string(),
          value: z.union([z.string(), z.number(), z.boolean()])
        })
      )
    })
  )
})
declare const treeNodeResult: InferReturns<typeof treeNodeSchema>
expectNotAny(treeNodeResult)

// --- Codec/Transform schemas: handler returns z.output (internal type), not z.input (wire type) ---
// This tests the fix for Zod 4.1 codec support where input !== output

// Simulate a pipe/transform schema where input !== output
// z.input = string (wire format), z.output = Date (internal representation)
declare const codecSchema: z.ZodPipe<z.ZodString, z.ZodDate>
declare const codecResult: InferReturns<typeof codecSchema>
expectNotAny(codecResult)
// Handler should return Date (z.output), not string (z.input)
// @ts-expect-error - If this errors with "unused directive", Result is string (the bug)
const _codecInvalid: typeof codecResult = 'not a date'

// Test with transform (coerce pattern)
const coerceNumberSchema = z.coerce.number()
declare const coerceResult: InferReturns<typeof coerceNumberSchema>
expectNotAny(coerceResult)
// @ts-expect-error - Result should be number, not string/any
const _coerceInvalid: typeof coerceResult = 'not a number'

// Test with preprocess (another transform pattern)
const preprocessedSchema = z.preprocess(val => String(val), z.string())
declare const preprocessResult: InferReturns<typeof preprocessedSchema>
expectNotAny(preprocessResult)
