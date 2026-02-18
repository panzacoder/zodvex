/**
 * Composes a codec customization with a user customization.
 * Codec input runs first (wraps ctx.db), user input runs second
 * (sees codec-wrapped ctx.db).
 *
 * Propagates hooks, transforms, and onSuccess from the user's customization
 * through the composed return value so customFnBuilder can find them.
 *
 * @internal Exported for testing only -- not part of the public API.
 */
export function composeCodecAndUser(
  codecCust: { args: Record<string, never>; input: (ctx: any, args: any, extra?: any) => any },
  userCust: { args?: any; input?: (ctx: any, args: any, extra?: any) => any }
) {
  return {
    args: userCust.args ?? {},
    input: async (ctx: any, args: any, extra?: any) => {
      // 1. Codec layer: wrap ctx.db
      const codecResult = await codecCust.input(ctx, {}, extra)
      const codecCtx = { ...ctx, ...codecResult.ctx }

      // 2. User layer: sees codec-wrapped ctx.db
      if (!userCust.input) {
        return { ctx: codecResult.ctx, args: {} }
      }
      const userResult = await userCust.input(codecCtx, args, extra)

      // 3. Merge ctx/args; pass through user's hooks/transforms/onSuccess
      return {
        ctx: { ...codecResult.ctx, ...(userResult.ctx ?? {}) },
        args: userResult.args ?? {},
        // Preserve both zodvex (hooks) and convex-helpers (onSuccess) conventions
        ...(userResult.hooks && { hooks: userResult.hooks }),
        ...(userResult.onSuccess && { onSuccess: userResult.onSuccess }),
        ...(userResult.transforms && { transforms: userResult.transforms })
      }
    }
  }
}
