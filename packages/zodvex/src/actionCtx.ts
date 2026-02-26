import type { GenericActionCtx, GenericDataModel } from 'convex/server'
import { getFunctionName } from 'convex/server'
import { z } from 'zod'
import { safeEncode } from './normalizeCodecPaths'
import type { AnyRegistry } from './types'
import { stripUndefined } from './utils'

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
  return {
    ...ctx,
    runQuery: async (ref: any, ...restArgs: any[]) => {
      const path = getFunctionName(ref)
      const entry = registry[path]
      const args = restArgs[0]
      const wireArgs =
        entry?.args && args != null ? stripUndefined(safeEncode(entry.args, args)) : args
      const wireResult = await ctx.runQuery(ref, wireArgs)
      if (!entry?.returns) return wireResult
      return entry.returns.parse(wireResult)
    },
    runMutation: async (ref: any, ...restArgs: any[]) => {
      const path = getFunctionName(ref)
      const entry = registry[path]
      const args = restArgs[0]
      const wireArgs =
        entry?.args && args != null ? stripUndefined(safeEncode(entry.args, args)) : args
      const wireResult = await ctx.runMutation(ref, wireArgs)
      if (!entry?.returns) return wireResult
      return entry.returns.parse(wireResult)
    }
  } as GenericActionCtx<DM>
}
