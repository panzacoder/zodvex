import type {
  ActionBuilder,
  FunctionVisibility,
  GenericActionCtx,
  GenericDatabaseReader,
  GenericDatabaseWriter,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
  MutationBuilder,
  QueryBuilder
} from 'convex/server'
import { NoOp } from 'convex-helpers/server/customFunctions'
import type { z } from 'zod'
import { createCodecCallOverrides } from '../actionCtx'
import { createZodvexCustomization, type ZodvexUnderlyingDb } from '../customization'
import type { ZodvexDatabaseReader, ZodvexDatabaseWriter } from '../db'
import type { ZodValidator } from '../mapping'
import type { ZodTableMap } from '../schema'
import type { AnyRegistry, ExtractCtx, Overwrite } from '../types'
import type { $ZodObject } from '../zod-core'
import { applyCustomizationResult, type MergePatch } from './contracts'
import type { CustomBuilder, DeclarationContext, DeclaredContext } from './customFunctions'
import { zCustomAction, zCustomMutation, zCustomQuery } from './customFunctions'

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
 * causing MergePatch<Ctx, Record<string, never>> to strip all properties via Omit<Ctx, string>.
 * The {} type has keyof = never, so MergePatch passes through correctly.
 */
// biome-ignore lint/complexity/noBannedTypes: {} is semantically correct here — see comment above
type NoCodecCtx = {}

type InternalCustomization<
  Ctx extends object = Record<string, unknown>,
  Patch extends Record<string, unknown> = Record<string, unknown>,
  Extra extends Record<string, unknown> = Record<string, unknown>
> = {
  args: Record<string, never>
  input: (
    ctx: Ctx,
    args: Record<string, never>,
    extra?: Extra
  ) => MaybePromise<{
    ctx: Patch
    args: Record<string, never>
  }>
}

type InitServerBuilders<DM extends GenericDataModel> = {
  query: QueryBuilder<DM, 'public'>
  mutation: MutationBuilder<DM, 'public'>
  action: ActionBuilder<DM, 'public'>
  internalQuery: QueryBuilder<DM, 'internal'>
  internalMutation: MutationBuilder<DM, 'internal'>
  internalAction: ActionBuilder<DM, 'internal'>
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
declare const declarationContext: unique symbol
export type ZodvexCustomization<
  InputCtx,
  ZArgs extends ZodValidator,
  CustomCtx extends Record<string, any>,
  CustomMadeArgs extends Record<string, any>,
  ExtraArgs extends Record<string, any>,
  M extends DeclarationContext | undefined = undefined,
  Mode extends 'merge' | 'replace' = 'merge'
> = {
  readonly [declarationContext]?: M
  contextMode?: Mode
  validateDeclaration?: (extra: ExtraArgs) => undefined
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
    ExtraArgs extends Record<string, any> = Record<string, any>,
    M extends DeclarationContext | undefined = undefined,
    Mode extends 'merge' | 'replace' = 'merge'
  >(
    customization: ZodvexCustomization<
      MergePatch<InputCtx, CodecCtx>,
      ZArgs,
      CustomCtx,
      CustomMadeArgs,
      ExtraArgs,
      M,
      Mode
    >
  ) => CustomBuilder<
    FuncType,
    ResolvedCustomArgs<ZArgs>,
    Mode extends 'replace' ? CustomCtx : MergePatch<CodecCtx, CustomCtx>,
    CustomMadeArgs,
    Mode extends 'replace' ? NoCodecCtx : InputCtx,
    Visibility,
    ExtraArgs,
    M
  >
}

type AnyZodvexBuilder = ZodvexBuilder<any, any, any, any>
type ContextHook = (params: { ctx: unknown; args: unknown; result: unknown }) => unknown
type RuntimeContextResult = {
  ctx: Record<string, unknown>
  args?: Record<string, unknown>
  onSuccess?: ContextHook
}
type AnyContext = {
  readonly [declarationContext]?: DeclarationContext
  contextMode?: 'merge' | 'replace'
  args?: ZodValidator
  validateDeclaration?: (extra: any) => undefined
  input?: (ctx: any, args: any, extra?: any) => MaybePromise<RuntimeContextResult>
}
type ContextSource = AnyZodvexBuilder | AnyContext
type ContextOutput<C> = ContextParts<C>['mode'] extends 'replace'
  ? ContextParts<C>['output']
  : MergePatch<ContextParts<C>['input'], ContextParts<C>['output']>

/**
 * The input ctx a builder's `.withContext()` expects (the codec-wrapped ctx).
 * Same-kind builders share it — `zm`/`zim`, `za`/`zia`, `zq`/`ziq` differ only in
 * visibility — so a customization typed against it is reusable across both.
 */
type InputCtxOf<B extends ContextSource> =
  B extends ZodvexBuilder<any, infer CodecCtx, infer InputCtx, any>
    ? MergePatch<InputCtx, CodecCtx>
    : ContextOutput<B>

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
export function defineContext<M extends DeclarationContext>(): <
  B extends ContextSource,
  ZArgs extends ZodValidator = Record<string, never>,
  CustomCtx extends Record<string, any> = Record<string, never>,
  CustomMadeArgs extends Record<string, any> = Record<string, never>,
  ExtraArgs extends Record<string, any> = Record<string, any>,
  Mode extends 'merge' | 'replace' = 'merge'
>(
  _builder: B,
  customization: ZodvexCustomization<
    InputCtxOf<B>,
    ZArgs,
    CustomCtx,
    CustomMadeArgs,
    ExtraArgs,
    M,
    Mode
  >
) => ZodvexCustomization<InputCtxOf<B>, ZArgs, CustomCtx, CustomMadeArgs, ExtraArgs, M, Mode>
export function defineContext<
  B extends ContextSource,
  ZArgs extends ZodValidator = Record<string, never>,
  CustomCtx extends Record<string, any> = Record<string, never>,
  CustomMadeArgs extends Record<string, any> = Record<string, never>,
  ExtraArgs extends Record<string, any> = Record<string, any>,
  Mode extends 'merge' | 'replace' = 'merge'
>(
  _builder: B,
  customization: ZodvexCustomization<
    InputCtxOf<B>,
    ZArgs,
    CustomCtx,
    CustomMadeArgs,
    ExtraArgs,
    undefined,
    Mode
  >
): ZodvexCustomization<InputCtxOf<B>, ZArgs, CustomCtx, CustomMadeArgs, ExtraArgs, undefined, Mode>
export function defineContext(_builder?: unknown, customization?: unknown): any {
  if (_builder === undefined) return (_builder: unknown, value: unknown) => value
  return customization
}

type ContextParts<C> =
  C extends ZodvexCustomization<infer I, infer A, infer O, infer Made, infer E, infer M, infer Mode>
    ? { input: I; args: A; output: O; made: Made; extra: E; mapper: M; mode: Mode }
    : never
type WithoutEmptyIndex<T> = T extends Record<string, never> ? NoCodecCtx : T
type MergeParts<
  T extends readonly AnyContext[],
  P extends 'args' | 'made' | 'extra'
> = T extends readonly [infer H extends AnyContext, ...infer R extends AnyContext[]]
  ? WithoutEmptyIndex<ContextParts<H>[P]> & MergeParts<R, P>
  : NoCodecCtx
type FoldContext<T extends readonly AnyContext[], I> = T extends readonly [
  infer H extends AnyContext,
  ...infer R extends AnyContext[]
]
  ? FoldContext<
      R,
      ContextParts<H>['mode'] extends 'replace'
        ? ContextParts<H>['output']
        : MergePatch<I, ContextParts<H>['output']>
    >
  : I
type MapperStep = {
  mode: 'merge' | 'replace'
  keys: PropertyKey
  mapper: DeclarationContext | undefined
}
type MapperSteps<T extends readonly AnyContext[]> = {
  [K in keyof T]: {
    mode: ContextParts<T[K]>['mode']
    keys: keyof ContextParts<T[K]>['output']
    mapper: ContextParts<T[K]>['mapper']
  }
}
type FoldDeclared<T extends readonly MapperStep[], D, I = NoCodecCtx> = T extends readonly [
  infer H extends MapperStep,
  ...infer R extends MapperStep[]
]
  ? FoldDeclared<
      R,
      D,
      MergePatch<
        Omit<H['mode'] extends 'replace' ? NoCodecCtx : I, H['keys']>,
        DeclaredContext<H['mapper'], D>
      >
    >
  : I
export interface ComposedMapper<T extends readonly MapperStep[]> extends DeclarationContext {
  readonly context: FoldDeclared<T, this['declaration']>
}
type CompositionMapper<T extends readonly AnyContext[]> =
  Extract<ContextParts<T[number]>['mapper'], DeclarationContext> extends never
    ? undefined
    : ComposedMapper<MapperSteps<T>>
type CompatibleSequence<T extends readonly AnyContext[], I> = T extends readonly [
  infer H extends AnyContext,
  ...infer R extends AnyContext[]
]
  ? I extends ContextParts<H>['input']
    ? CompatibleSequence<R, FoldContext<[H], I>>
    : never
  : unknown

/** Compose inputs in order and success hooks in reverse order; later context keys win. */
export function composeContexts<const T extends readonly [AnyContext, ...AnyContext[]]>(
  ...contexts: T & CompatibleSequence<T, ContextParts<T[0]>['input']>
): ZodvexCustomization<
  ContextParts<T[0]>['input'],
  MergeParts<T, 'args'>,
  FoldContext<T, ContextParts<T[0]>['input']>,
  MergeParts<T, 'made'>,
  MergeParts<T, 'extra'>,
  CompositionMapper<T>,
  'replace'
>
export function composeContexts(...contexts: AnyContext[]): unknown {
  const args: ZodValidator = {}
  for (const context of contexts) {
    for (const [key, validator] of Object.entries(context.args ?? {})) {
      if (Object.hasOwn(args, key)) throw new Error('Duplicate context argument: ' + key)
      args[key] = validator
    }
  }
  const composed: AnyContext = {
    contextMode: 'replace',
    args,
    validateDeclaration(extra: Record<string, unknown>) {
      for (const context of contexts) {
        const result: unknown = context.validateDeclaration?.(extra)
        if (result !== undefined) {
          Promise.resolve(result).catch(() => undefined)
          throw new Error('validateDeclaration must be synchronous and return undefined')
        }
      }
    },
    async input(
      ctx: Record<string, unknown>,
      args: Record<string, unknown>,
      extra?: Record<string, unknown>
    ) {
      let current = ctx
      const made: Record<string, unknown> = {}
      const hooks: ContextHook[] = []
      for (const context of contexts) {
        const ownArgs = Object.fromEntries(
          Object.keys(context.args ?? {}).map(key => [key, args[key]])
        )
        const added = await context.input?.(current, ownArgs, extra)
        current =
          context.contextMode === 'replace' ? (added?.ctx ?? {}) : { ...current, ...added?.ctx }
        for (const [key, value] of Object.entries(added?.args ?? {})) {
          if (Object.hasOwn(made, key))
            throw new Error('Duplicate injected context argument: ' + key)
          made[key] = value
        }
        if (added?.onSuccess) hooks.push(added.onSuccess)
      }
      return {
        ctx: current,
        args: made,
        onSuccess: async (params: Parameters<ContextHook>[0]) => {
          for (const hook of hooks.reverse()) await hook(params)
        }
      }
    }
  }
  return composed
}

// Overload 1: wrapDb: false — no codec DB wrapping
export function initZodvex<DM extends GenericDataModel>(
  schema: { __zodTableMap: ZodTableMap },
  server: {
    query: QueryBuilder<DM, 'public'>
    mutation: MutationBuilder<DM, 'public'>
    action: ActionBuilder<DM, 'public'>
    internalQuery: QueryBuilder<DM, 'internal'>
    internalMutation: MutationBuilder<DM, 'internal'>
    internalAction: ActionBuilder<DM, 'internal'>
  },
  options: { wrapDb: false; registry?: () => AnyRegistry }
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
  schema: { __zodTableMap: ZodTableMap; __decodedDocs: DD },
  server: {
    query: QueryBuilder<DM, 'public'>
    mutation: MutationBuilder<DM, 'public'>
    action: ActionBuilder<DM, 'public'>
    internalQuery: QueryBuilder<DM, 'internal'>
    internalMutation: MutationBuilder<DM, 'internal'>
    internalAction: ActionBuilder<DM, 'internal'>
  },
  options?: {
    wrapDb?: true
    registry?: () => AnyRegistry
    /**
     * Resolve the database the codec wrapper delegates to, instead of `ctx.db`.
     * Lets native-shape layers (e.g. convex-helpers triggers) sit under the
     * codec layer — codec on top → triggers → real db. See #92.
     *
     * ```ts
     * const triggers = new Triggers<DataModel>()
     * initZodvex(schema, server, {
     *   underlyingDb: { mutation: (ctx) => triggers.wrapDB(ctx).db }
     * })
     * ```
     */
    underlyingDb?: ZodvexUnderlyingDb<
      GenericQueryCtx<DM>,
      GenericMutationCtx<DM>,
      GenericDatabaseReader<DM>,
      GenericDatabaseWriter<DM>
    >
  }
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
export function initZodvex<DM extends GenericDataModel, DD extends Record<string, unknown>>(
  schema: { __zodTableMap: ZodTableMap; __decodedDocs?: DD },
  server: InitServerBuilders<DM>,
  options?: {
    wrapDb?: boolean
    registry?: () => AnyRegistry
    underlyingDb?: ZodvexUnderlyingDb<
      GenericQueryCtx<DM>,
      GenericMutationCtx<DM>,
      GenericDatabaseReader<DM>,
      GenericDatabaseWriter<DM>
    >
  }
) {
  const wrap = options?.wrapDb !== false
  if (!wrap && options?.underlyingDb) {
    throw new Error(
      '[zodvex] initZodvex: `underlyingDb` requires the codec db wrapper — ' +
        'remove `wrapDb: false` or drop `underlyingDb`.'
    )
  }
  const codec = createZodvexCustomization<DM, DD>(schema.__zodTableMap, {
    underlyingDb: options?.underlyingDb
  })
  const noOp = createNoOpCustomization()

  const registryThunk = options?.registry
  const actionCust = createActionCustomization<DM>(registryThunk, noOp)
  function createBuilders<
    QueryPatch extends Record<string, unknown>,
    MutationPatch extends Record<string, unknown>
  >(
    queryCust: InternalCustomization<GenericQueryCtx<DM>, QueryPatch>,
    mutationDbCust: InternalCustomization<GenericMutationCtx<DM>, MutationPatch>
  ) {
    const mutationCust = createMutationCustomization(mutationDbCust, registryThunk)
    return {
      zq: createZodvexBuilder(server.query, queryCust, zCustomQuery),
      zm: createZodvexBuilder(server.mutation, mutationCust, zCustomMutation),
      za: createZodvexBuilder(server.action, actionCust, zCustomAction),
      ziq: createZodvexBuilder(server.internalQuery, queryCust, zCustomQuery),
      zim: createZodvexBuilder(server.internalMutation, mutationCust, zCustomMutation),
      zia: createZodvexBuilder(server.internalAction, actionCust, zCustomAction)
    }
  }
  return wrap ? createBuilders(codec.query, codec.mutation) : createBuilders(noOp, noOp)
}

function createNoOpCustomization(): InternalCustomization<object, NoCodecCtx> {
  return { args: {} as Record<string, never>, input: NoOp.input }
}

function createActionCustomization<DM extends GenericDataModel>(
  registryThunk: (() => AnyRegistry) | undefined,
  noOp: InternalCustomization<object, NoCodecCtx>
): InternalCustomization<GenericActionCtx<DM>, NoCodecCtx> {
  if (!registryThunk) {
    return noOp
  }

  return {
    args: {} as Record<string, never>,
    input: async (ctx: GenericActionCtx<DM>) => ({
      // Auto-encode codec args at outbound call sites: runQuery/runMutation
      // (encode args, decode result) and scheduler.runAfter/runAt (encode args).
      ctx: createCodecCallOverrides(registryThunk(), ctx),
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
 */
function createMutationCustomization<
  DM extends GenericDataModel,
  Patch extends Record<string, unknown>
>(
  dbCust: InternalCustomization<GenericMutationCtx<DM>, Patch>,
  registryThunk: (() => AnyRegistry) | undefined
): InternalCustomization<GenericMutationCtx<DM>, Patch> {
  if (!registryThunk) {
    return dbCust
  }

  return {
    args: {} as Record<string, never>,
    input: async (
      ctx: GenericMutationCtx<DM>,
      _args: Record<string, never>,
      extra?: Record<string, unknown>
    ) => {
      const dbResult = await dbCust.input(ctx, {}, extra)
      const callOverrides = createCodecCallOverrides(registryThunk(), ctx)
      return {
        ctx: { ...dbResult.ctx, ...callOverrides },
        args: {}
      }
    }
  }
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
export function composeCustomizations<
  Ctx extends object,
  CodecCtx extends Record<string, unknown>,
  ZArgs extends ZodValidator = Record<string, never>,
  CustomCtx extends Record<string, unknown> = Record<string, never>,
  MadeArgs extends Record<string, unknown> = Record<string, never>,
  Extra extends Record<string, unknown> = Record<string, unknown>,
  M extends DeclarationContext | undefined = undefined,
  Mode extends 'merge' | 'replace' = 'merge'
>(
  codecCust: InternalCustomization<Ctx, CodecCtx, Extra>,
  userCust: ZodvexCustomization<
    MergePatch<Ctx, CodecCtx>,
    ZArgs,
    CustomCtx,
    MadeArgs,
    Extra,
    M,
    Mode
  >
) {
  return {
    args: userCust.args ?? {},
    validateDeclaration: userCust.validateDeclaration,
    input: async (ctx: Ctx, args: ResolvedCustomArgs<ZArgs>, extra?: Extra) => {
      // 1. Codec layer: wrap ctx.db
      const codecResult = await codecCust.input(ctx, {}, extra)
      // The public builder contract models context patches with MergePatch.
      // Generic object spread otherwise infers an incompatible intersection.
      const codecCtx = { ...ctx, ...codecResult.ctx } as MergePatch<Ctx, CodecCtx>

      // 2. User layer: sees codec-wrapped ctx.db
      if (!userCust.input) {
        return userCust.contextMode === 'replace'
          ? { ctx: {}, args: {}, replaceContext: true }
          : { ctx: codecResult.ctx, args: {} }
      }
      const userResult = await userCust.input(codecCtx, args, extra)

      // 3. Merge ctx/args; pass through user's onSuccess (convex-helpers convention)
      const merged = applyCustomizationResult(codecResult.ctx, {}, userResult)
      return {
        ctx: userCust.contextMode === 'replace' ? userResult.ctx : merged.finalCtx,
        replaceContext: userCust.contextMode === 'replace',
        args: merged.finalArgs,
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
type BuilderCtx<B> = ExtractCtx<B> extends object ? ExtractCtx<B> : never
type FactoryFor<B extends (definition: never) => object> =
  ReturnType<B> extends { isQuery: true }
    ? typeof zCustomQuery
    : ReturnType<B> extends { isMutation: true }
      ? typeof zCustomMutation
      : typeof zCustomAction

// Keep the factory aligned with the public contract as conditional patch types
// flow through initZodvex overloads. The implementation is checked against it.
export function createZodvexBuilder<
  Builder extends (definition: never) => object,
  CodecCtx extends Record<string, unknown>
>(
  rawBuilder: Builder,
  codecCust: InternalCustomization<BuilderCtx<Builder>, CodecCtx>,
  customFn: FactoryFor<NoInfer<Builder>>
): ZodvexBuilder<
  ReturnType<Builder> extends { isQuery: true }
    ? 'query'
    : ReturnType<Builder> extends { isMutation: true }
      ? 'mutation'
      : 'action',
  CodecCtx,
  BuilderCtx<Builder>,
  ReturnType<Builder> extends { isInternal: true } ? 'internal' : 'public'
> {
  type Ctx = BuilderCtx<Builder>
  type Kind =
    ReturnType<Builder> extends { isQuery: true }
      ? 'query'
      : ReturnType<Builder> extends { isMutation: true }
        ? 'mutation'
        : 'action'
  type Visibility = ReturnType<Builder> extends { isInternal: true } ? 'internal' : 'public'
  // These legacy entry points type declared args as Convex validators even
  // though their shared implementation also accepts Zod shapes. Retain their
  // known registration contract at this one schema-language boundary.
  const registerBase = customFn as unknown as (
    builder: Builder,
    customization: InternalCustomization<Ctx, CodecCtx>
  ) => CustomBuilder<
    Kind,
    Record<string, never>,
    CodecCtx,
    Record<string, never>,
    Ctx,
    Visibility,
    Record<string, unknown>
  >
  const base = registerBase(rawBuilder, codecCust)

  const withContext = <
    ZArgs extends ZodValidator = Record<string, never>,
    CustomCtx extends Record<string, unknown> = Record<string, never>,
    MadeArgs extends Record<string, unknown> = Record<string, never>,
    Extra extends Record<string, unknown> = Record<string, unknown>,
    M extends DeclarationContext | undefined = undefined,
    Mode extends 'merge' | 'replace' = 'merge'
  >(
    userCust: ZodvexCustomization<
      MergePatch<Ctx, CodecCtx>,
      ZArgs,
      CustomCtx,
      MadeArgs,
      Extra,
      M,
      Mode
    >
  ) => {
    const composed = composeCustomizations(codecCust, userCust)
    // zCustom* still expose Convex-only customization declarations for legacy
    // callers. Their runtime also handles Zod declarations; this adapter keeps
    // that schema-language boundary local while retaining decoded argument types.
    const register = customFn as unknown as (
      builder: Builder,
      customization: typeof composed
    ) => CustomBuilder<
      Kind,
      ResolvedCustomArgs<ZArgs>,
      Mode extends 'replace' ? CustomCtx : MergePatch<CodecCtx, CustomCtx>,
      MadeArgs,
      Mode extends 'replace' ? NoCodecCtx : Ctx,
      Visibility,
      Extra,
      M
    >
    return register(rawBuilder, composed)
  }

  return Object.assign(base, { withContext })
}
