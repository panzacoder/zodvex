/**
 * Database hooks for intercepting decode/encode operations.
 *
 * Hooks are grouped: operation-first (decode/encode) -> timing (before/after)
 * -> cardinality (one/many).
 *
 * - `decode.before.one` / `decode.after.one` — per-document transforms on read
 * - `decode.before.many` / `decode.after.many` — batch transforms on read
 * - `encode.before` / `encode.after` — transforms on write (single-doc only)
 *
 * Returning `null` from a `one` or encode hook short-circuits the pipeline.
 * `many` hooks receive a pre-bound `one` as the third argument — they choose
 * whether to delegate to it or implement batch logic directly.
 */

// ---------------------------------------------------------------------------
// Document types
// ---------------------------------------------------------------------------

/** Wire-format document (as stored in / returned from Convex). */
export type WireDoc = Record<string, unknown>

/** Runtime-format document (after codec decode, e.g. Dates instead of timestamps). */
export type RuntimeDoc = Record<string, unknown>

// ---------------------------------------------------------------------------
// Hook function signatures
// ---------------------------------------------------------------------------

export type DecodeOneHook<Ctx> = (
  ctx: Ctx,
  doc: WireDoc
) => Promise<WireDoc | null> | WireDoc | null

export type DecodeManyHook<Ctx> = (
  ctx: Ctx,
  docs: WireDoc[],
  one: (doc: WireDoc) => Promise<WireDoc | null>
) => Promise<WireDoc[]> | WireDoc[]

export type DecodeAfterOneHook<Ctx> = (
  ctx: Ctx,
  doc: RuntimeDoc
) => Promise<RuntimeDoc | null> | RuntimeDoc | null

export type DecodeAfterManyHook<Ctx> = (
  ctx: Ctx,
  docs: RuntimeDoc[],
  one: (doc: RuntimeDoc) => Promise<RuntimeDoc | null>
) => Promise<RuntimeDoc[]> | RuntimeDoc[]

export type EncodeHook<Ctx> = (
  ctx: Ctx,
  doc: RuntimeDoc
) => Promise<RuntimeDoc | null> | RuntimeDoc | null

export type EncodeAfterHook<Ctx> = (
  ctx: Ctx,
  doc: WireDoc
) => Promise<WireDoc | null> | WireDoc | null

// ---------------------------------------------------------------------------
// Hook config types
// ---------------------------------------------------------------------------

export type DecodeHooks<Ctx> = {
  before?: {
    one?: DecodeOneHook<Ctx>
    many?: DecodeManyHook<Ctx>
  }
  after?: {
    one?: DecodeAfterOneHook<Ctx>
    many?: DecodeAfterManyHook<Ctx>
  }
}

export type EncodeHooks<Ctx> = {
  before?: EncodeHook<Ctx>
  after?: EncodeAfterHook<Ctx>
}

export type DatabaseHooks<Ctx = any> = {
  decode?: DecodeHooks<Ctx>
  encode?: EncodeHooks<Ctx>
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a typed database hooks config.
 *
 * This is a type-level helper — it returns the config object as-is but ensures
 * the `Ctx` generic is threaded through all hook signatures.
 */
export function createDatabaseHooks<Ctx>(config: DatabaseHooks<Ctx>): DatabaseHooks<Ctx> {
  return config
}

// ---------------------------------------------------------------------------
// Composition helpers
// ---------------------------------------------------------------------------

/**
 * Compose an array of `one`-style hooks (decode.before.one, decode.after.one,
 * encode.before, encode.after) that support null short-circuiting.
 *
 * Each hook receives the output of the previous one. If any hook returns null,
 * the pipeline short-circuits and returns null immediately.
 */
function composeOneHooks<Fn extends (ctx: any, doc: any) => Promise<any> | any>(fns: Fn[]): Fn {
  if (fns.length === 1) return fns[0]

  const composed = async (ctx: any, doc: any) => {
    let current = doc
    for (const fn of fns) {
      current = await fn(ctx, current)
      if (current === null) return null
    }
    return current
  }

  return composed as unknown as Fn
}

/**
 * Compose an array of `many`-style hooks. Each hook receives the composed
 * `one` hook as its third argument so it can choose whether to delegate.
 */
function composeManyHooks<Fn extends (ctx: any, docs: any[], one: any) => Promise<any[]> | any[]>(
  fns: Fn[]
): Fn {
  if (fns.length === 1) return fns[0]

  const composed = async (ctx: any, docs: any[], one: any) => {
    let current = docs
    for (const fn of fns) {
      current = await fn(ctx, current, one)
    }
    return current
  }

  return composed as unknown as Fn
}

// ---------------------------------------------------------------------------
// composeHooks
// ---------------------------------------------------------------------------

/**
 * Compose multiple hook configs into a single config.
 *
 * - Empty array returns `{}`.
 * - Single element is returned as-is (reference equality preserved).
 * - Multiple hooks are piped in order for each stage.
 *   - `one` hooks chain with null short-circuiting.
 *   - `many` hooks chain in order; the composed `one` is passed as third arg.
 *   - `encode.before` / `encode.after` chain with null short-circuiting.
 */
export function composeHooks<Ctx>(hooks: DatabaseHooks<Ctx>[]): DatabaseHooks<Ctx> {
  if (hooks.length === 0) return {}
  if (hooks.length === 1) return hooks[0]

  const result: DatabaseHooks<Ctx> = {}

  // --- decode.before ---
  const decodeBeforeOneFns = hooks
    .map(h => h.decode?.before?.one)
    .filter((fn): fn is NonNullable<typeof fn> => fn != null)

  const decodeBeforeManyFns = hooks
    .map(h => h.decode?.before?.many)
    .filter((fn): fn is NonNullable<typeof fn> => fn != null)

  if (decodeBeforeOneFns.length > 0 || decodeBeforeManyFns.length > 0) {
    if (!result.decode) result.decode = {}
    if (!result.decode.before) result.decode.before = {}

    if (decodeBeforeOneFns.length > 0) {
      result.decode.before.one = composeOneHooks(decodeBeforeOneFns)
    }
    if (decodeBeforeManyFns.length > 0) {
      result.decode.before.many = composeManyHooks(decodeBeforeManyFns)
    }
  }

  // --- decode.after ---
  const decodeAfterOneFns = hooks
    .map(h => h.decode?.after?.one)
    .filter((fn): fn is NonNullable<typeof fn> => fn != null)

  const decodeAfterManyFns = hooks
    .map(h => h.decode?.after?.many)
    .filter((fn): fn is NonNullable<typeof fn> => fn != null)

  if (decodeAfterOneFns.length > 0 || decodeAfterManyFns.length > 0) {
    if (!result.decode) result.decode = {}
    if (!result.decode.after) result.decode.after = {}

    if (decodeAfterOneFns.length > 0) {
      result.decode.after.one = composeOneHooks(decodeAfterOneFns)
    }
    if (decodeAfterManyFns.length > 0) {
      result.decode.after.many = composeManyHooks(decodeAfterManyFns)
    }
  }

  // --- encode.before ---
  const encodeBeforeFns = hooks
    .map(h => h.encode?.before)
    .filter((fn): fn is NonNullable<typeof fn> => fn != null)

  // --- encode.after ---
  const encodeAfterFns = hooks
    .map(h => h.encode?.after)
    .filter((fn): fn is NonNullable<typeof fn> => fn != null)

  if (encodeBeforeFns.length > 0 || encodeAfterFns.length > 0) {
    if (!result.encode) result.encode = {}

    if (encodeBeforeFns.length > 0) {
      result.encode.before = composeOneHooks(encodeBeforeFns)
    }
    if (encodeAfterFns.length > 0) {
      result.encode.after = composeOneHooks(encodeAfterFns)
    }
  }

  return result
}
