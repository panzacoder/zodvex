import {
  type DefaultFunctionArgs,
  type RegisteredAction,
  type RegisteredMutation,
  type RegisteredQuery
} from 'convex/server'
import { z } from 'zod'

export type InferArgs<A> = A extends z.ZodObject<infer S>
  ? z.infer<z.ZodObject<S>>
  : A extends Record<string, z.ZodTypeAny>
    ? { [K in keyof A]: z.infer<A[K]> }
    : A extends z.ZodTypeAny
      ? z.infer<A>
      : Record<string, never>

export type InferReturns<R> = R extends z.ZodTypeAny ? z.output<R> : R extends undefined ? any : R

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
export type ZodToConvexArgs<A> = Simplify<
  A extends z.ZodObject<infer Shape>
    ? { [K in keyof Shape]: any }
    : A extends Record<string, z.ZodTypeAny>
      ? { [K in keyof A]: any }
      : A extends z.ZodTypeAny
        ? { value: any }
        : Record<string, never>
>
