import {
  type DefaultFunctionArgs,
  type RegisteredAction,
  type RegisteredMutation,
  type RegisteredQuery
} from 'convex/server'
import type { GenericId } from 'convex/values'
import { z } from 'zod'

export type InferArgs<A> = A extends z.ZodObject<infer S>
  ? z.infer<z.ZodObject<S>>
  : A extends Record<string, z.ZodTypeAny>
    ? { [K in keyof A]: z.infer<A[K]> }
    : A extends z.ZodTypeAny
      ? z.infer<A>
      : Record<string, never>

// Import ZodCustom type if available
type ZodCustomType = z.ZodType extends { _brand: 'ZodCustom' } ? z.ZodType : any

// Helper to extract type from ZodCustom without deep recursion
type ExtractCustomOutput<T> = T extends z.ZodType<infer O, any, any>
  ? T extends { _def: { type: 'custom' } }
    ? O
    : never
  : never

// Return type inference with immediate bailout for unions/custom to avoid depth
export type InferReturns<R> =
  R extends z.ZodUnion<any> ? any :        // Bail immediately for unions
  R extends z.ZodCustom<any> ? any :       // Bail immediately for custom
  R extends z.ZodType<any, any, any> ?
    z.output<R> :                           // Use z.output for other schemas
  R extends undefined ? any :
  R

// For handler authoring: what the handler returns before wrapper validation/encoding
export type InferHandlerReturns<R> =
  R extends z.ZodUnion<any> ? any :        // Bail immediately for unions
  R extends z.ZodCustom<any> ? any :       // Bail immediately for custom
  R extends z.ZodType<any, any, any> ?
    z.input<R> :                            // Use z.input for other schemas
  any

export type ExtractCtx<Builder> = Builder extends {
  (fn: { handler: (ctx: infer Ctx, ...args: any[]) => any }): any
}
  ? Ctx
  : never

// Simplified: directly map to the registered types without intermediate type utilities
export type PreserveReturnType<
  Builder extends (...args: any) => any,
  ArgsType,
  ReturnsType
> = ReturnType<Builder> extends RegisteredQuery<infer V, any, any>
  ? RegisteredQuery<
      V,
      ArgsType extends DefaultFunctionArgs ? ArgsType : DefaultFunctionArgs,
      Promise<ReturnsType>
    >
  : ReturnType<Builder> extends RegisteredMutation<infer V, any, any>
    ? RegisteredMutation<
        V,
        ArgsType extends DefaultFunctionArgs ? ArgsType : DefaultFunctionArgs,
        Promise<ReturnsType>
      >
    : ReturnType<Builder> extends RegisteredAction<infer V, any, any>
      ? RegisteredAction<
          V,
          ArgsType extends DefaultFunctionArgs ? ArgsType : DefaultFunctionArgs,
          Promise<ReturnsType>
        >
      : ReturnType<Builder>

// Helper type to extract value while preserving Id types
type ExtractValue<T> = T extends z.ZodType<infer U>
  ? U extends GenericId<any>
    ? U
    : any
  : any

// Preserve keys and Id types for proper Convex type generation
export type ZodToConvexArgs<A> =
  A extends z.ZodObject<infer Shape>
    ? { [K in keyof Shape]: ExtractValue<Shape[K]> }
    : A extends Record<string, z.ZodTypeAny>
      ? { [K in keyof A]: ExtractValue<A[K]> }
      : A extends z.ZodTypeAny
        ? { value: any }
        : Record<string, never>
