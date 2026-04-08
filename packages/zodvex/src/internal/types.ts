import type {
  DefaultFunctionArgs,
  RegisteredAction,
  RegisteredMutation,
  RegisteredQuery
} from 'convex/server'
import type { GenericId } from 'convex/values'
// import type { z } from 'zod' -- removed; replaced by $ZodCodec from zod/v4/core
import type { $ZodCodec, $ZodType, infer as zinfer, output as zoutput } from 'zod/v4/core'

export type InferArgs<A> = A extends $ZodType & { shape: infer S extends Record<string, $ZodType> }
  ? { [K in keyof S]: zinfer<S[K]> }
  : A extends Record<string, $ZodType>
    ? { [K in keyof A]: zinfer<A[K]> }
    : A extends $ZodType
      ? zinfer<A>
      : Record<string, never>

// Return type inference - uses zoutput for Zod schemas
// Previously had bailouts for unions/custom to avoid TypeScript depth errors,
// but research (Issue #20) showed convex-helpers handles these without issues.
// Removing bailouts fixes Issue #19 (Promise<any> return types).
export type InferReturns<R> =
  R extends $ZodType<any, any> ? zoutput<R> : R extends undefined ? any : R

// For handler authoring: what the handler returns before wrapper validation/encoding
// Uses zoutput since the handler produces the internal representation (e.g., Date),
// which is then encoded to wire format (e.g., string) before sending to the client
export type InferHandlerReturns<R> = R extends $ZodType<any, any> ? zoutput<R> : any

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
export type PreserveReturnType<Builder extends (...args: any) => any, ArgsType, ReturnsType> =
  ReturnType<Builder> extends RegisteredQuery<infer V, any, any>
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
export type ZodToConvexArgs<A> = A extends $ZodType & {
  shape: infer S extends Record<string, $ZodType>
}
  ? { [K in keyof S]: zinfer<S[K]> }
  : A extends Record<string, $ZodType>
    ? { [K in keyof A]: zinfer<A[K]> }
    : A extends $ZodType
      ? { value: zinfer<A> }
      : Record<string, never>

/**
 * Brand symbol for preserving wire schema type through type aliases.
 * Allows ConvexValidatorFromZod to extract wire schema even when
 * consumers wrap ZodCodec in custom type aliases.
 *
 * @internal Used by ZodvexCodec type and ConvexValidatorFromZod
 */
declare const ZodvexWireSchema: unique symbol
export { ZodvexWireSchema }

/**
 * A branded ZodCodec that preserves wire schema type information.
 * Use this when creating type aliases for custom codecs to ensure
 * zodvex can infer the correct Convex validator.
 *
 * @example
 * ```typescript
 * type MyCodec<T> = ZodvexCodec<
 *   z.ZodObject<{ value: T }>, // zod-ok
 *   z.ZodCustom<MyClass<T>> // zod-ok
 * >
 *
 * function myCodec<T extends $ZodType>(inner: T): MyCodec<T> {
 *   return zodvexCodec(
 *     z.object({ value: inner }),
 *     z.custom<MyClass<z.output<T>>>(() => true),
 *     { decode: ..., encode: ... }
 *   )
 * }
 * ```
 */
export type ZodvexCodec<Wire extends $ZodType, Runtime extends $ZodType> = $ZodCodec<
  Wire,
  Runtime
> & {
  readonly [ZodvexWireSchema]: Wire
}

/**
 * Overwrites properties of T with properties of U.
 * Properties in U replace same-named properties in T.
 * Guard clause: when U has no keys (e.g. {}), returns T unchanged —
 * prevents collapse when U is an empty context type.
 */
export type Overwrite<T, U> = keyof U extends never ? T : Omit<T, keyof U> & U

/**
 * Registry shape: maps function paths (e.g. "tasks:list") to optional
 * args/returns Zod schemas that define the codec transforms.
 *
 * Produced by zodvex codegen into `_zodvex/api.ts` and consumed by all
 * four codec boundary implementations: hooks, client, actionCtx, initZodvex.
 */
export type AnyRegistry = Record<string, { args?: $ZodType; returns?: $ZodType }>
