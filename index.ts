export { zodToConvex, zodToConvexFields, analyzeZod, getObjectShape, makeUnion, simpleToConvex } from './src/mapping'
export { convexCodec, type ConvexCodec, toConvexJS, fromConvexJS } from './src/codec'
export { zQuery, zInternalQuery, zMutation, zInternalMutation, zAction, zInternalAction } from './src/wrappers'
export { zCustomQuery, zCustomMutation, zCustomAction } from './src/custom'
export { zodTable, zCrud } from './src/tables'
export { zLoose } from './src/loose'
export type { InferArgs, InferReturns, InferHandlerReturns, ExtractCtx, PreserveReturnType, ZodToConvexArgs, Loose } from './src/types'
export { zid, type Zid } from './src/ids'
export { returnsAs } from './src/utils'

// vNext: Minimal, from-scratch wrappers with simple typing and runtime behavior.
// These are intentionally small to avoid deep type instantiation and are
// safe to experiment with in apps without pulling in lots of generics.
import { z } from 'zod'
import { zodToConvex, zodToConvexFields } from './src/mapping'
import { toConvexJS, fromConvexJS } from './src/codec'

export namespace vnext {
  // Minimal type helpers
  export type ArgsOf<A> =
    A extends z.ZodObject<any> ? z.output<A> :
    A extends Record<string, z.ZodTypeAny> ? { [K in keyof A]: z.output<A[K]> } :
    A extends z.ZodTypeAny ? { value: z.output<A> } :
    Record<string, never>

  export type HandlerReturn<R> = R extends z.ZodTypeAny ? z.input<R> : unknown

  function buildArgs(input: any): { zodSchema: z.ZodTypeAny; args: Record<string, any> } {
    if (input && typeof input === 'object' && (input as any)._zod?.def?.type === 'object') {
      return { zodSchema: input as z.ZodTypeAny, args: zodToConvexFields(input as any) }
    }
    if (input && typeof input === 'object' && !(input as any)._zod) {
      const zodSchema = z.object(input as Record<string, z.ZodTypeAny>)
      return { zodSchema, args: zodToConvexFields(input as any) }
    }
    // Single Zod value → normalize to { value }
    const zodSchema = z.object({ value: input as z.ZodTypeAny })
    return { zodSchema, args: { value: zodToConvex(input as z.ZodTypeAny) } }
  }

  export function query<
    Builder extends (fn: any) => any,
    A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
    R extends z.ZodTypeAny | undefined = undefined
  >(
    builder: Builder,
    input: A,
    handler: (ctx: any, args: ArgsOf<A>) => HandlerReturn<R> | Promise<HandlerReturn<R>>,
    options?: { returns?: R }
  ): ReturnType<Builder> {
    const { zodSchema, args } = buildArgs(input)
    const returns = options?.returns ? zodToConvex(options.returns) : undefined

    return builder({
      args,
      returns,
      handler: async (ctx: any, rawArgs: unknown) => {
        const decoded = fromConvexJS(rawArgs, zodSchema)
        const parsed = zodSchema.parse(decoded)
        const raw = await handler(ctx, parsed as any)
        if (options?.returns) {
          const validated = (options.returns as z.ZodTypeAny).parse(raw)
          return toConvexJS(options.returns as z.ZodTypeAny, validated)
        }
        return toConvexJS(raw)
      }
    }) as ReturnType<Builder>
  }

  export function mutation<
    Builder extends (fn: any) => any,
    A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
    R extends z.ZodTypeAny | undefined = undefined
  >(
    builder: Builder,
    input: A,
    handler: (ctx: any, args: ArgsOf<A>) => HandlerReturn<R> | Promise<HandlerReturn<R>>,
    options?: { returns?: R }
  ): ReturnType<Builder> {
    return query(builder, input, handler, options)
  }

  export function action<
    Builder extends (fn: any) => any,
    A extends z.ZodTypeAny | Record<string, z.ZodTypeAny>,
    R extends z.ZodTypeAny | undefined = undefined
  >(
    builder: Builder,
    input: A,
    handler: (ctx: any, args: ArgsOf<A>) => HandlerReturn<R> | Promise<HandlerReturn<R>>,
    options?: { returns?: R }
  ): ReturnType<Builder> {
    return query(builder, input, handler, options)
  }
}
