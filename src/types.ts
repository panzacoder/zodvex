import { z } from 'zod'
import {
  type QueryBuilder,
  type MutationBuilder,
  type ActionBuilder,
  type RegisteredQuery,
  type RegisteredMutation,
  type RegisteredAction,
  type DefaultFunctionArgs
} from 'convex/server'
import type { CustomBuilder } from 'convex-helpers/server/customFunctions'

export type InferArgs<A> =
  A extends z.ZodObject<infer S>
    ? z.infer<z.ZodObject<S>>
    : A extends Record<string, z.ZodTypeAny>
      ? { [K in keyof A]: z.infer<A[K]> }
      : A extends z.ZodTypeAny
        ? z.infer<A>
        : Record<string, never>

export type InferReturns<R> = R extends z.ZodTypeAny ? z.output<R> : R extends undefined ? any : R

export type ExtractCtx<Builder> = Builder extends { (fn: { handler: (ctx: infer Ctx, ...args: any[]) => any }): any }
  ? Ctx
  : never

export type PreserveReturnType<Builder, ArgsType, ReturnsType> =
  Builder extends QueryBuilder<any, infer Visibility>
    ? RegisteredQuery<Visibility, ArgsType extends DefaultFunctionArgs ? ArgsType : DefaultFunctionArgs, Promise<ReturnsType>>
    : Builder extends MutationBuilder<any, infer Visibility>
      ? RegisteredMutation<Visibility, ArgsType extends DefaultFunctionArgs ? ArgsType : DefaultFunctionArgs, Promise<ReturnsType>>
      : Builder extends ActionBuilder<any, infer Visibility>
        ? RegisteredAction<Visibility, ArgsType extends DefaultFunctionArgs ? ArgsType : DefaultFunctionArgs, Promise<ReturnsType>>
      : Builder extends CustomBuilder<'query', any, any, any, any, infer V, any>
        ? RegisteredQuery<V, ArgsType extends DefaultFunctionArgs ? ArgsType : DefaultFunctionArgs, Promise<ReturnsType>>
      : Builder extends CustomBuilder<'mutation', any, any, any, any, infer V, any>
        ? RegisteredMutation<V, ArgsType extends DefaultFunctionArgs ? ArgsType : DefaultFunctionArgs, Promise<ReturnsType>>
      : Builder extends CustomBuilder<'action', any, any, any, any, infer V, any>
        ? RegisteredAction<V, ArgsType extends DefaultFunctionArgs ? ArgsType : DefaultFunctionArgs, Promise<ReturnsType>>
      : Builder extends (...args: any[]) => any
        ? ReturnType<Builder>
        : never

export type ZodToConvexArgs<A> =
  A extends z.ZodObject<infer Shape>
    ? { [K in keyof Shape]: any }
    : A extends Record<string, z.ZodTypeAny>
      ? { [K in keyof A]: any }
      : A extends z.ZodTypeAny
        ? { value: any }
        : Record<string, never>

