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

// Return type inference - uses z.output for Zod schemas
// Previously had bailouts for unions/custom to avoid TypeScript depth errors,
// but research (Issue #20) showed convex-helpers handles these without issues.
// Removing bailouts fixes Issue #19 (Promise<any> return types).
export type InferReturns<R> = R extends z.ZodType<any, any, any>
  ? z.output<R>
  : R extends undefined
    ? any
    : R

// For handler authoring: what the handler returns before wrapper validation/encoding
// Uses z.input since this is what the handler produces before encoding
export type InferHandlerReturns<R> = R extends z.ZodType<any, any, any> ? z.input<R> : any

/**
 * Extract the visibility type from a Convex builder function
 */
export type ExtractVisibility<Builder extends (...args: any) => any> =
  ReturnType<Builder> extends RegisteredQuery<infer V, any, any>
    ? V
    : ReturnType<Builder> extends RegisteredMutation<infer V, any, any>
      ? V
      : ReturnType<Builder> extends RegisteredAction<infer V, any, any>
        ? V
        : 'public'

/**
 * @deprecated Use GenericQueryCtx, GenericMutationCtx, or GenericActionCtx directly instead
 */
export type ExtractCtx<Builder> = Builder extends {
  (fn: { handler: (ctx: infer Ctx, ...args: any[]) => any }): any
}
  ? Ctx
  : never

/**
 * @deprecated Return types are now specified explicitly using RegisteredQuery, RegisteredMutation, or RegisteredAction
 */
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

// Preserve keys and Id types for proper Convex type generation
export type ZodToConvexArgs<A> = A extends z.ZodObject<any>
  ? z.infer<A>
  : A extends Record<string, z.ZodTypeAny>
    ? { [K in keyof A]: z.infer<A[K]> }
    : A extends z.ZodTypeAny
      ? { value: z.infer<A> }
      : Record<string, never>
