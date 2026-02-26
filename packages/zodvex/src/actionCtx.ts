import type { GenericActionCtx, GenericDataModel } from 'convex/server'
import { createCodecHelpers } from './codecHelpers'
import type { AnyRegistry } from './types'

/**
 * Wraps an action context's runQuery/runMutation with automatic
 * codec transforms via the zodvex registry.
 *
 * - Args are encoded (runtime -> wire) before calling the inner function
 * - Results are decoded (wire -> runtime) before returning to the handler
 * - Functions not in the registry pass through unchanged
 *
 * @internal Used by initZodvex when registry option is provided.
 */
export function createZodvexActionCtx<DM extends GenericDataModel>(
  registry: AnyRegistry,
  ctx: GenericActionCtx<DM>
): GenericActionCtx<DM> {
  const codec = createCodecHelpers(registry)

  return {
    ...ctx,
    runQuery: async (ref: any, ...restArgs: any[]) => {
      const wireArgs = codec.encodeArgs(ref, restArgs[0])
      const wireResult = await ctx.runQuery(ref, wireArgs)
      return codec.decodeResult(ref, wireResult)
    },
    runMutation: async (ref: any, ...restArgs: any[]) => {
      const wireArgs = codec.encodeArgs(ref, restArgs[0])
      const wireResult = await ctx.runMutation(ref, wireArgs)
      return codec.decodeResult(ref, wireResult)
    }
  } as GenericActionCtx<DM>
}
