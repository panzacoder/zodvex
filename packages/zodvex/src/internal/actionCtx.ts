import type { GenericActionCtx, GenericDataModel, Scheduler } from 'convex/server'
import type { BoundaryHelpers, BoundaryHelpersOptions } from './boundaryHelpers'
import { createBoundaryHelpers } from './boundaryHelpers'
import type { AnyRegistry } from './types'

/**
 * Wraps a `runQuery`/`runMutation` function so it encodes codec args
 * (runtime -> wire) before the call and decodes the result (wire -> runtime)
 * after. Functions not in the registry pass through unchanged.
 *
 * Arity-preserving: only the args slot (position 0 after the ref) is
 * encoded; everything after it is forwarded untouched. Convex ≥1.41 passes
 * an options object there (`ArgsAndOptions` — e.g. `transactionLimits`),
 * which an earlier version of this wrapper silently dropped.
 */
function wrapRun(fn: (ref: any, ...rest: any[]) => Promise<any>, codec: BoundaryHelpers) {
  return async (ref: any, ...rest: any[]) => {
    if (rest.length > 0) rest[0] = codec.encodeArgs(ref, rest[0])
    const wireResult = await fn(ref, ...rest)
    return codec.decodeResult(ref, wireResult)
  }
}

/**
 * Wraps a {@link Scheduler} so `runAfter`/`runAt` encode codec args to wire
 * before scheduling.
 *
 * A scheduled function crosses the Convex boundary exactly like `runMutation`:
 * the caller holds *decoded* (runtime) values, but Convex serializes the args
 * against the target's *wire* validator. A non-serializable runtime value (e.g.
 * a Symbol-valued codec field) cannot cross at all, and branded/`SensitiveField`
 * codecs are the wrong shape — so the args must be encoded first.
 *
 * Return values are NOT decoded: the scheduler returns the scheduled-function
 * id, not the target's result. Other members (e.g. `cancel`) pass through.
 */
function wrapScheduler(scheduler: Scheduler, codec: BoundaryHelpers): Scheduler {
  const wrapped: any = { ...scheduler }
  wrapped.runAfter = (delayMs: number, ref: any, ...rest: any[]) => {
    if (rest.length > 0) rest[0] = codec.encodeArgs(ref, rest[0])
    return (scheduler.runAfter as any)(delayMs, ref, ...rest)
  }
  wrapped.runAt = (timestamp: number | Date, ref: any, ...rest: any[]) => {
    if (rest.length > 0) rest[0] = codec.encodeArgs(ref, rest[0])
    return (scheduler.runAt as any)(timestamp, ref, ...rest)
  }
  return wrapped as Scheduler
}

/**
 * Builds ctx overrides that auto-encode codec args at outbound call sites:
 * - `runQuery` / `runMutation`: encode args, decode result.
 * - `scheduler.runAfter` / `scheduler.runAt`: encode args.
 *
 * Only the members present on the given ctx are included, so this serves both
 * action ctx (run* + scheduler) and mutation ctx (scheduler only).
 *
 * @internal Used by initZodvex when the `registry` option is provided.
 */
export function createCodecCallOverrides(
  registry: AnyRegistry,
  ctx: { runQuery?: unknown; runMutation?: unknown; scheduler?: Scheduler },
  options?: BoundaryHelpersOptions
): Record<string, unknown> {
  const codec = createBoundaryHelpers(registry, options)
  const overrides: Record<string, unknown> = {}
  if (typeof ctx.runQuery === 'function') {
    overrides.runQuery = wrapRun(ctx.runQuery as any, codec)
  }
  if (typeof ctx.runMutation === 'function') {
    overrides.runMutation = wrapRun(ctx.runMutation as any, codec)
  }
  if (ctx.scheduler) {
    overrides.scheduler = wrapScheduler(ctx.scheduler, codec)
  }
  return overrides
}

/**
 * Wraps an action context's runQuery/runMutation and scheduler with automatic
 * codec transforms via the zodvex registry.
 *
 * - Args are encoded (runtime -> wire) before calling the inner function
 * - Results are decoded (wire -> runtime) before returning to the handler
 *   (runQuery/runMutation only — the scheduler returns a scheduled-function id)
 * - Functions not in the registry pass through unchanged
 *
 * @internal Used by initZodvex when registry option is provided.
 */
export function createZodvexActionCtx<DM extends GenericDataModel>(
  registry: AnyRegistry,
  ctx: GenericActionCtx<DM>,
  options?: BoundaryHelpersOptions
): GenericActionCtx<DM> {
  return { ...ctx, ...createCodecCallOverrides(registry, ctx, options) } as GenericActionCtx<DM>
}
