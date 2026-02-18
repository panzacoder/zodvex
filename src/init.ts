import type { zCustomAction, zCustomMutation, zCustomQuery } from './custom'

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

/**
 * Creates a zodvex-enhanced builder: a CustomBuilder callable with
 * a .withContext() method for composing user customizations.
 *
 * .withContext() is NOT chainable — returns a plain CustomBuilder.
 * To compose multiple customizations, compose them before passing
 * to .withContext().
 *
 * @internal Exported for testing only -- not part of the public API.
 */
export function createZodvexBuilder(
  rawBuilder: any,
  codecCust: { args: Record<string, never>; input: (ctx: any, args: any, extra?: any) => any },
  customFn: typeof zCustomQuery | typeof zCustomMutation | typeof zCustomAction
) {
  const base: any = customFn(rawBuilder as any, codecCust as any)

  base.withContext = (userCust: any) => {
    const composed = composeCodecAndUser(codecCust, userCust)
    return customFn(rawBuilder as any, composed as any)
  }

  return base
}
