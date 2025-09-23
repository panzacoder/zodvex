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

export type InferReturns<R> = R extends z.ZodTypeAny ? z.output<R> : R extends undefined ? any : R

// For handler authoring: what the handler returns before wrapper validation/encoding
export type InferHandlerReturns<R> = R extends z.ZodTypeAny ? z.input<R> : any

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
      ReturnsType
    >
  : ReturnType<Builder> extends RegisteredMutation<infer V, any, any>
    ? RegisteredMutation<
        V,
        ArgsType extends DefaultFunctionArgs ? ArgsType : DefaultFunctionArgs,
        ReturnsType
      >
    : ReturnType<Builder> extends RegisteredAction<infer V, any, any>
      ? RegisteredAction<
          V,
          ArgsType extends DefaultFunctionArgs ? ArgsType : DefaultFunctionArgs,
          ReturnsType
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
