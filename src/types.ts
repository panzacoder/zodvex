import {
  type DefaultFunctionArgs,
  type RegisteredAction,
  type RegisteredMutation,
  type RegisteredQuery
} from 'convex/server'
import { z } from 'zod'

// Type flattening utility from convex-helpers
// Forces TypeScript to eagerly evaluate intersection types into single object types
// This prevents deep instantiation issues with complex type intersections
export type Expand<T> = T extends Record<any, any>
  ? { [K in keyof T]: T[K] }
  : T

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

// Flattens mapped/conditional types for better readability and sometimes helps instantiation
type Simplify<T> = { [K in keyof T]: T[K] } & {}

// Remap only Args/Returns on an already-registered function type
type WithArgsAndReturns<F, ArgsType, ReturnsType> = F extends RegisteredQuery<infer V, any, any>
  ? RegisteredQuery<
      V,
      ArgsType extends DefaultFunctionArgs ? ArgsType : DefaultFunctionArgs,
      ReturnsType
    >
  : F extends RegisteredMutation<infer V, any, any>
    ? RegisteredMutation<
        V,
        ArgsType extends DefaultFunctionArgs ? ArgsType : DefaultFunctionArgs,
        ReturnsType
      >
    : F extends RegisteredAction<infer V, any, any>
      ? RegisteredAction<
          V,
          ArgsType extends DefaultFunctionArgs ? ArgsType : DefaultFunctionArgs,
          ReturnsType
        >
      : never

// Base on the actual registered type returned by the builder and only swap args/returns.
// Note: no Promise wrapper here; Convex codegen will await-normalize on the client side.
export type PreserveReturnType<
  Builder extends (...args: any) => any,
  ArgsType,
  ReturnsType
> = WithArgsAndReturns<ReturnType<Builder>, ArgsType, ReturnsType>

// Preserve precise argument types for better client API types.
// Fall back to empty object when no args.
// Mark a Zod schema as "loose" to opt-out of deep type instantiation.
export type Loose<T extends z.ZodTypeAny> = T & { _zodvexLooseBrand?: true }

export type ZodToConvexArgs<A> = Simplify<
  A extends z.ZodObject<any>
    ? (A extends { _zodvexLooseBrand?: true }
        ? Record<string, unknown>
        : z.infer<A>)
    : A extends Record<string, z.ZodTypeAny>
      ? { [K in keyof A]: z.infer<A[K]> }
      : A extends z.ZodTypeAny
        ? { value: z.infer<A> }
        : Record<string, never>
>
