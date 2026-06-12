import type {
  ActionBuilder,
  FunctionVisibility,
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
  MutationBuilder,
  QueryBuilder
} from 'convex/server'
import { NoOp } from 'convex-helpers/server/customFunctions'
import type { z } from 'zod'
import { createCodecCallOverrides } from './actionCtx'
import type { CustomBuilder } from './custom'
import { zCustomAction, zCustomMutation, zCustomQuery } from './custom'
import { createZodvexCustomization } from './customization'
import type { ZodvexDatabaseReader, ZodvexDatabaseWriter } from './db'
import type { ZodValidator } from './mapping'
import type { ZodTableMap } from './schema'
import type { AnyRegistry, Overwrite } from './types'
import type { $ZodObject } from './zod-core'

/**
 * The context type received by query handlers when wrapDb: true.
 * Replaces ctx.db with ZodvexDatabaseReader while preserving auth, storage, etc.
 */
export type ZodvexQueryCtx<
  DM extends GenericDataModel,
  DD extends Record<string, any> = Record<string, any>
> = Overwrite<GenericQueryCtx<DM>, { db: ZodvexDatabaseReader<DM, DD> }>

/**
 * The context type received by mutation handlers when wrapDb: true.
 * Replaces ctx.db with ZodvexDatabaseWriter while preserving auth, storage, etc.
 */
export type ZodvexMutationCtx<
  DM extends GenericDataModel,
  DD extends Record<string, any> = Record<string, any>
> = Overwrite<GenericMutationCtx<DM>, { db: ZodvexDatabaseWriter<DM, DD> }>

/**
 * The context type received by action handlers.
 * Currently identical to GenericActionCtx (actions don't have ctx.db),
 * but exported for API symmetry and forward compatibility.
 */
export type ZodvexActionCtx<DM extends GenericDataModel> = GenericActionCtx<DM>

/**
 * Empty codec context — used when the codec layer adds nothing to ctx (e.g. actions, wrapDb:false).
 *
 * MUST be {} not Record<string, never>. Record<string, never> has keyof = string (index signature),
 * causing Overwrite<Ctx, Record<string, never>> to strip all properties via Omit<Ctx, string>.
 * The {} type has keyof = never, so Overwrite passes through correctly.
 */
// biome-ignore lint/complexity/noBannedTypes: {} is semantically correct here — see comment above
type NoCodecCtx = {}

type InternalCustomization = {
  args: Record<string, never>
  input: (ctx: any, args: any, extra?: any) => any
}

type InternalCustomFn = (builder: any, customization: any) => any

type InitServerBuilders = {
  query: QueryBuilder<any, 'public'>
  mutation: MutationBuilder<any, 'public'>
  action: ActionBuilder<any, 'public'>
  internalQuery: QueryBuilder<any, 'internal'>
  internalMutation: MutationBuilder<any, 'internal'>
  internalAction: ActionBuilder<any, 'internal'>
}

type MaybePromise<T> = T | Promise<T>

/**
 * The runtime type of a customization's declared args (`z.output`), with one
 * correction for the **empty** case: `z.output<$ZodObject<{}>>` widens to
 * `{ [x: string]: unknown }`, which is wrong (an args-less customization receives
 * no args) and breaks standalone customizations whose `input` params are
 * hand-annotated narrower than that wide index signature (the #72-fallout
 * regression). `{} extends ZArgs` catches both `{}` and the `Record<string, never>`
 * default while staying false for real declared args.
 */
type ResolvedCustomArgs<ZArgs extends ZodValidator> =
  // biome-ignore lint/complexity/noBannedTypes: {} is the empty-object probe, intentional
  {} extends ZArgs ? Record<string, never> : z.output<$ZodObject<ZArgs>>

/**
 * A `.withContext()` customization for zodvex builders. Unlike convex-helpers'
 * `Customization` (which types `args` as Convex `PropertyValidators`), the
 * declared `args` are **zod** — they run through the same zod→Convex + codec
 * pipeline as consumer args, so `input` receives the **decoded runtime** values
 * and the resulting function registers the wire validator. See #72.
 *
 * For a reusable, standalone customization, author it with {@link defineContext}
 * (full inference, zero annotations) — a bare object literal has no contextual
 * type, so its `input` params would otherwise need hand-annotations that drift
 * from this type.
 */
export type ZodvexCustomization<
  InputCtx,
  ZArgs extends ZodValidator,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  ExtraArgs extends Record<string, any>
> = {
  args?: ZArgs
  input?: (
    ctx: InputCtx,
    args: ResolvedCustomArgs<ZArgs>,
    extra?: ExtraArgs
  ) => MaybePromise<{
    ctx: CustomCtx
    args?: CustomMadeArgs
    onSuccess?: (params: { ctx: unknown; args: unknown; result: unknown }) => unknown
  }>
}

/**
 * A zodvex builder: callable CustomBuilder + .withContext() for composing
 * user customizations on top of the codec layer.
 *
 * .withContext() is NOT chainable — returns a plain CustomBuilder.
 * To compose multiple customizations, compose them before passing to .withContext().
 */
export type ZodvexBuilder<
  FuncType extends 'query' | 'mutation' | 'action',
  CodecCtx extends Record<string, any>,
  InputCtx extends Record<string, any>,
  Visibility extends FunctionVisibility
> = CustomBuilder<
  FuncType,
  Record<string, never>,
  CodecCtx,
  Record<string, never>,
  InputCtx,
  Visibility,
  Record<string, any>
> & {
  withContext: <
    ZArgs extends ZodValidator = Record<string, never>,
    CustomCtx extends Record<string, any> = Record<string, never>,
    CustomMadeArgs extends Record<string, any> = Record<string, never>,
    ExtraArgs extends Record<string, any> = Record<string, any>
  >(
    customization: ZodvexCustomization<
      Overwrite<InputCtx, CodecCtx>,
      ZArgs,
      CustomCtx,
      CustomMadeArgs,
      ExtraArgs
    >
  ) => CustomBuilder<
    FuncType,
    ResolvedCustomArgs<ZArgs>,
    Overwrite<CodecCtx, CustomCtx>,
    CustomMadeArgs,
    InputCtx,
    Visibility,
    ExtraArgs
  >
}

type AnyZodvexBuilder = ZodvexBuilder<any, any, any, any>

/**
 * The input ctx a builder's `.withContext()` expects (the codec-wrapped ctx).
 * Same-kind builders share it — `zm`/`zim`, `za`/`zia`, `zq`/`ziq` differ only in
 * visibility — so a customization typed against it is reusable across both.
 */
type InputCtxOf<B extends AnyZodvexBuilder> =
  B extends ZodvexBuilder<any, infer CodecCtx, infer InputCtx, any>
    ? Overwrite<InputCtx, CodecCtx>
    : never

/**
 * Author a reusable `.withContext()` customization with full type inference.
 *
 * A standalone customization object has no contextual type, so its `input` params
 * trip `noImplicitAny` and must be hand-annotated — and that hand annotation drifts
 * from zodvex's internal type (the #72-fallout break). `defineContext` is an
 * **identity at runtime** (`(_builder, c) => c`); its sole purpose is to be an
 * inference site:
 *
 * - the `builder` argument pins the input ctx, so `input`'s `ctx` and `args` are
 *   inferred (zero annotations);
 * - the output generics (`CustomCtx` / `CustomMadeArgs` / `ExtraArgs`) are inferred
 *   from your `input`'s return, so the handler downstream still sees the precise
 *   merged ctx (which a standalone type annotation cannot do — only inference from
 *   the value, via this function, preserves it).
 *
 * The result carries no visibility, so it feeds **both** same-kind builders — pass
 * either (`zm`/`zim`, `za`/`zia`, `zq`/`ziq` share the input ctx):
 *
 * ```ts
 * const authed = defineContext(zm, {
 *   args: {},
 *   input: async (ctx, _args, extra?: { required?: Entitlement[] }) => ({
 *     ctx: { ...ctx, identity: await resolveIdentity(ctx) },
 *     args: {},
 *   }),
 * })
 * export const appMutation         = zm.withContext(authed)
 * export const appInternalMutation = zim.withContext(authed)
 * ```
 */
export function defineContext<
  B extends AnyZodvexBuilder,
  ZArgs extends ZodValidator = Record<string, never>,
  CustomCtx extends Record<string, any> = Record<string, never>,
  CustomMadeArgs extends Record<string, any> = Record<string, never>,
  ExtraArgs extends Record<string, any> = Record<string, any>
>(
  _builder: B,
  customization: ZodvexCustomization<InputCtxOf<B>, ZArgs, CustomCtx, CustomMadeArgs, ExtraArgs>
): ZodvexCustomization<InputCtxOf<B>, ZArgs, CustomCtx, CustomMadeArgs, ExtraArgs> {
  return customization
}

type ZodTableMapThunk = () => ZodTableMap | Promise<ZodTableMap>

/**
 * Registry thunk for cross-function codec auto-encoding. May return the
 * registry directly (the `registry: () => zodvexRegistry` pattern) or a
 * Promise of it (the codegen-emitted lazy loader); both are resolved and
 * cached on first use.
 */
type RegistryThunk = () => AnyRegistry | Promise<AnyRegistry>

interface InitZodvexOptionsBase {
  /**
   * Lazy tableMap loader — provided by the codegen-emitted `_zodvex/server.ts`.
   * When provided, schema does NOT need to carry `__zodTableMap`; the
   * runtime codec wrappers resolve the map on first DB call and cache it.
   * Required for the schema-only-thin pattern (schema.ts uses plain
   * `defineSchema(tables)`).
   */
  tableMap?: ZodTableMapThunk
  /**
   * Enables cross-function codec auto-encoding: `ctx.runQuery` /
   * `ctx.runMutation` encode codec args and decode results (actions), and
   * `ctx.scheduler.runAfter` / `ctx.scheduler.runAt` encode codec args
   * (actions and mutations).
   *
   * A thunk backed by dynamic `import()` only works in actions (Node runtime).
   * Mutations run in Convex's V8 sandbox, which forbids dynamic import — the
   * scheduler-encoding path there needs a statically-backed thunk, which the
   * codegen-emitted `_zodvex/server.ts` provides.
   */
  registry?: RegistryThunk
}

// Overload 1: wrapDb: false — no codec DB wrapping
export function initZodvex<DM extends GenericDataModel>(
  schema: { __zodTableMap?: ZodTableMap },
  server: {
    query: QueryBuilder<DM, 'public'>
    mutation: MutationBuilder<DM, 'public'>
    action: ActionBuilder<DM, 'public'>
    internalQuery: QueryBuilder<DM, 'internal'>
    internalMutation: MutationBuilder<DM, 'internal'>
    internalAction: ActionBuilder<DM, 'internal'>
  },
  options: InitZodvexOptionsBase & { wrapDb: false }
): {
  zq: ZodvexBuilder<'query', NoCodecCtx, GenericQueryCtx<DM>, 'public'>
  zm: ZodvexBuilder<'mutation', NoCodecCtx, GenericMutationCtx<DM>, 'public'>
  za: ZodvexBuilder<'action', NoCodecCtx, GenericActionCtx<DM>, 'public'>
  ziq: ZodvexBuilder<'query', NoCodecCtx, GenericQueryCtx<DM>, 'internal'>
  zim: ZodvexBuilder<'mutation', NoCodecCtx, GenericMutationCtx<DM>, 'internal'>
  zia: ZodvexBuilder<'action', NoCodecCtx, GenericActionCtx<DM>, 'internal'>
}

// Overload 2: wrapDb: true (default) — codec DB wrapping with decoded types
// DD (DecodedDocs) is inferred from schema.__decodedDocs, carrying the decoded
// document types computed by DecodedDocFor<T> in defineZodSchema.
export function initZodvex<
  DM extends GenericDataModel,
  DD extends Record<string, any> = Record<string, any>
>(
  schema: { __zodTableMap?: ZodTableMap; __decodedDocs?: DD },
  server: {
    query: QueryBuilder<DM, 'public'>
    mutation: MutationBuilder<DM, 'public'>
    action: ActionBuilder<DM, 'public'>
    internalQuery: QueryBuilder<DM, 'internal'>
    internalMutation: MutationBuilder<DM, 'internal'>
    internalAction: ActionBuilder<DM, 'internal'>
  },
  options?: InitZodvexOptionsBase & { wrapDb?: true }
): {
  zq: ZodvexBuilder<'query', { db: ZodvexDatabaseReader<DM, DD> }, GenericQueryCtx<DM>, 'public'>
  zm: ZodvexBuilder<
    'mutation',
    { db: ZodvexDatabaseWriter<DM, DD> },
    GenericMutationCtx<DM>,
    'public'
  >
  za: ZodvexBuilder<'action', NoCodecCtx, GenericActionCtx<DM>, 'public'>
  ziq: ZodvexBuilder<'query', { db: ZodvexDatabaseReader<DM, DD> }, GenericQueryCtx<DM>, 'internal'>
  zim: ZodvexBuilder<
    'mutation',
    { db: ZodvexDatabaseWriter<DM, DD> },
    GenericMutationCtx<DM>,
    'internal'
  >
  zia: ZodvexBuilder<'action', NoCodecCtx, GenericActionCtx<DM>, 'internal'>
}

// Implementation
export function initZodvex(
  schema: { __zodTableMap?: ZodTableMap },
  server: InitServerBuilders,
  options?: InitZodvexOptionsBase & { wrapDb?: boolean }
) {
  // Source-of-truth for the codec tableMap, in priority order:
  //   1. options.tableMap (lazy thunk from _zodvex/tableMap.lazy.js)
  //   2. schema.__zodTableMap (legacy defineZodSchema-driven shape)
  //   3. {} — no-op (wrapDb pages still work but produce no codec transforms)
  const tableMapSource: ZodTableMap | ZodTableMapThunk =
    options?.tableMap ?? schema.__zodTableMap ?? {}
  const codec = createZodvexCustomization(tableMapSource)
  const noOp = createNoOpCustomization()
  const wrap = options?.wrapDb !== false

  // One shared caching resolver feeds both the action and mutation
  // customizations, so an async thunk is awaited once per init bundle.
  const resolveRegistry = options?.registry ? createRegistryResolver(options.registry) : undefined
  const actionCust = createActionCustomization(resolveRegistry, noOp)
  const customizations = {
    query: wrap ? codec.query : noOp,
    mutation: createMutationCustomization(wrap ? codec.mutation : noOp, resolveRegistry),
    action: actionCust
  }

  return createInitBuilderBundle(server, customizations)
}

function createNoOpCustomization(): InternalCustomization {
  return { args: {} as Record<string, never>, input: NoOp.input }
}

/**
 * Wraps a registry thunk in a caching async resolver. The thunk may return
 * either an `AnyRegistry` (the sync `registry: () => zodvexRegistry` pattern)
 * or a `Promise<AnyRegistry>` (a codegen-emitted lazy loader). Both shapes
 * are awaited transparently and cached after the first resolution.
 */
function createRegistryResolver(thunk: RegistryThunk): () => Promise<AnyRegistry> {
  let cached: AnyRegistry | undefined
  return async () => {
    if (cached !== undefined) return cached
    cached = await thunk()
    return cached
  }
}

function createActionCustomization(
  resolveRegistry: (() => Promise<AnyRegistry>) | undefined,
  noOp: InternalCustomization
): InternalCustomization {
  if (!resolveRegistry) {
    return noOp
  }

  return {
    args: {} as Record<string, never>,
    input: async (ctx: any) => ({
      // Auto-encode codec args at outbound call sites: runQuery/runMutation
      // (encode args, decode result) and scheduler.runAfter/runAt (encode args).
      ctx: createCodecCallOverrides(await resolveRegistry(), ctx),
      args: {}
    })
  }
}

/**
 * Composes the codec DB customization with outbound codec-arg encoding for the
 * mutation builders. Mutations expose `ctx.scheduler` (runAfter/runAt), so when
 * a registry is provided those calls auto-encode decoded codec args to wire —
 * symmetric with the inbound decode the receiving function already performs.
 *
 * Without a registry, the DB customization is returned unchanged.
 *
 * Note: mutations run in Convex's V8 sandbox, which forbids dynamic `import()`.
 * Awaiting an already-resolved promise is fine there — but a registry thunk
 * that performs a dynamic import will throw in this path. The codegen-emitted
 * `_zodvex/server.ts` passes a statically-backed thunk for exactly this reason.
 */
function createMutationCustomization(
  dbCust: InternalCustomization,
  resolveRegistry: (() => Promise<AnyRegistry>) | undefined
): InternalCustomization {
  if (!resolveRegistry) {
    return dbCust
  }

  return {
    args: {} as Record<string, never>,
    input: async (ctx: any, _args: any, extra?: any) => {
      const dbResult = await dbCust.input(ctx, {}, extra)
      const callOverrides = createCodecCallOverrides(await resolveRegistry(), ctx)
      return {
        ctx: { ...dbResult.ctx, ...callOverrides },
        args: {}
      }
    }
  }
}

function getInitBuilderSpecs(
  server: InitServerBuilders,
  customizations: {
    query: InternalCustomization
    mutation: InternalCustomization
    action: InternalCustomization
  }
) {
  return [
    ['zq', server.query, customizations.query, zCustomQuery],
    ['zm', server.mutation, customizations.mutation, zCustomMutation],
    ['za', server.action, customizations.action, zCustomAction],
    ['ziq', server.internalQuery, customizations.query, zCustomQuery],
    ['zim', server.internalMutation, customizations.mutation, zCustomMutation],
    ['zia', server.internalAction, customizations.action, zCustomAction]
  ] as const
}

function createInitBuilderBundle(
  server: InitServerBuilders,
  customizations: {
    query: InternalCustomization
    mutation: InternalCustomization
    action: InternalCustomization
  }
) {
  const builders: Record<string, any> = {}

  for (const [key, rawBuilder, customization, customFn] of getInitBuilderSpecs(
    server,
    customizations
  )) {
    builders[key] = createZodvexBuilder(rawBuilder, customization, customFn as InternalCustomFn)
  }

  return builders
}

/**
 * Composes a codec customization with a user customization.
 * Codec input runs first (wraps ctx.db), user input runs second
 * (sees codec-wrapped ctx.db).
 *
 * Propagates onSuccess from the user's customization through the composed
 * return value so customFnBuilder can find it.
 *
 * @internal Exported for testing only -- not part of the public API.
 */
export function composeCustomizations(
  codecCust: InternalCustomization,
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

      // 3. Merge ctx/args; pass through user's onSuccess (convex-helpers convention)
      return {
        ctx: { ...codecResult.ctx, ...(userResult.ctx ?? {}) },
        args: userResult.args ?? {},
        ...(userResult.onSuccess && { onSuccess: userResult.onSuccess })
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
  codecCust: InternalCustomization,
  customFn: (builder: any, customization: any) => any
) {
  const base: any = customFn(rawBuilder as any, codecCust as any)

  base.withContext = (userCust: any) => {
    const composed = composeCustomizations(codecCust, userCust)
    return customFn(rawBuilder as any, composed as any)
  }

  return base
}
