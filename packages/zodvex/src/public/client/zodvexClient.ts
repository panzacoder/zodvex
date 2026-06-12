import type { AuthTokenFetcher, ConnectionState, MutationOptions } from 'convex/browser'
import { ConvexClient } from 'convex/browser'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import type { BoundaryHelpersOptions } from '../../internal/boundaryHelpers'
import { createBoundaryHelpers } from '../../internal/boundaryHelpers'
import type { AnyRegistry } from '../../internal/types'

export type ZodvexClientOptions = (
  | { url: string; token?: string | null }
  | { client: ConvexClient }
) &
  BoundaryHelpersOptions

/** Wrap a static token string as an AuthTokenFetcher for ConvexClient */
function tokenToFetcher(token: string): AuthTokenFetcher {
  return async () => token
}

export class ZodvexClient<R extends AnyRegistry = AnyRegistry> {
  private codec: ReturnType<typeof createBoundaryHelpers>
  private innerClient?: ConvexClient
  private url?: string
  private pendingAuthFetcher?: AuthTokenFetcher
  private pendingAuthOnChange?: (isAuthenticated: boolean) => void

  constructor(registry: R, options: ZodvexClientOptions) {
    this.codec = createBoundaryHelpers(registry, { onDecodeError: options.onDecodeError })
    if ('client' in options) {
      this.innerClient = options.client
    } else {
      this.url = options.url
      if (options.token) this.pendingAuthFetcher = tokenToFetcher(options.token)
    }
  }

  private getUrl(): string {
    if (this.url) return this.url
    throw new Error('[zodvex] ZodvexClient is missing a Convex URL.')
  }

  private getConvex(): ConvexClient {
    if (this.innerClient) return this.innerClient

    const client = new ConvexClient(this.getUrl())
    if (this.pendingAuthFetcher) {
      client.setAuth(this.pendingAuthFetcher, this.pendingAuthOnChange)
    }
    this.innerClient = client
    return client
  }

  get convex(): ConvexClient {
    return this.getConvex()
  }

  async query<Q extends FunctionReference<'query', any, any, any>>(
    ref: Q,
    args: Q['_args']
  ): Promise<Q['_returnType']> {
    const wireResult = await this.getConvex().query(
      ref,
      this.codec.encodeArgs(ref, args) as FunctionArgs<Q>
    )
    return this.codec.decodeResult(ref, wireResult)
  }

  async mutate<M extends FunctionReference<'mutation', any, any, any>>(
    ref: M,
    args: M['_args'],
    options?: MutationOptions
  ): Promise<M['_returnType']> {
    const wireResult = await this.getConvex().mutation(
      ref,
      this.codec.encodeArgs(ref, args) as FunctionArgs<M>,
      options
    )
    return this.codec.decodeResult(ref, wireResult)
  }

  /** Alias for {@link mutate} — matches `ConvexClient.mutation` / `ZodvexReactClient.mutation`. */
  mutation<M extends FunctionReference<'mutation', any, any, any>>(
    ref: M,
    args: M['_args'],
    options?: MutationOptions
  ): Promise<M['_returnType']> {
    return this.mutate(ref, args, options)
  }

  async action<A extends FunctionReference<'action', any, any, any>>(
    ref: A,
    args: A['_args']
  ): Promise<A['_returnType']> {
    const wireResult = await this.getConvex().action(
      ref,
      this.codec.encodeArgs(ref, args) as FunctionArgs<A>
    )
    return this.codec.decodeResult(ref, wireResult)
  }

  subscribe<Q extends FunctionReference<'query', any, any, any>>(
    ref: Q,
    args: Q['_args'],
    callback: (result: Q['_returnType']) => void,
    onError?: (e: Error) => void
  ): () => void {
    const wireArgs = this.codec.encodeArgs(ref, args) as FunctionArgs<Q>
    return this.getConvex().onUpdate(
      ref,
      wireArgs,
      (wireResult: FunctionReturnType<Q>) => {
        callback(this.codec.decodeResult(ref, wireResult))
      },
      onError
    )
  }

  /** Alias for {@link subscribe} — matches `ConvexClient.onUpdate`. */
  onUpdate<Q extends FunctionReference<'query', any, any, any>>(
    ref: Q,
    args: Q['_args'],
    callback: (result: Q['_returnType']) => void,
    onError?: (e: Error) => void
  ): () => void {
    return this.subscribe(ref, args, callback, onError)
  }

  /**
   * Experimental paginated subscription. Encodes args to wire and decodes each
   * page item through the registry, mirroring {@link subscribe}.
   */
  onPaginatedUpdate_experimental<Q extends FunctionReference<'query', any, any, any>>(
    ref: Q,
    args: Q['_args'],
    options: { initialNumItems: number },
    callback: (result: {
      page: Q['_returnType'][]
      isDone: boolean
      continueCursor: string
      [key: string]: unknown
    }) => void,
    onError?: (e: Error) => void
  ): ReturnType<ConvexClient['onPaginatedUpdate_experimental']> {
    const wireArgs = this.codec.encodeArgs(ref, args) as FunctionArgs<Q>
    return this.getConvex().onPaginatedUpdate_experimental(
      ref,
      wireArgs,
      options,
      (wireResult: any) => {
        callback({
          ...wireResult,
          page: wireResult.page.map((item: any) => this.codec.decodeResult(ref, item))
        })
      },
      onError
    ) as ReturnType<ConvexClient['onPaginatedUpdate_experimental']>
  }

  /**
   * Set the auth token. Accepts either a raw token string (convenience) or a
   * Convex `AuthTokenFetcher` plus optional `onChange` callback (parity with
   * `ConvexClient.setAuth`).
   */
  setAuth(token: string | null): void
  setAuth(fetchToken: AuthTokenFetcher, onChange?: (isAuthenticated: boolean) => void): void
  setAuth(
    tokenOrFetcher: string | null | AuthTokenFetcher,
    onChange?: (isAuthenticated: boolean) => void
  ): void {
    const fetcher: AuthTokenFetcher =
      typeof tokenOrFetcher === 'function' ? tokenOrFetcher : async () => tokenOrFetcher
    this.pendingAuthFetcher = fetcher
    this.pendingAuthOnChange = onChange
    if (this.innerClient) {
      this.innerClient.setAuth(fetcher, onChange)
    }
  }

  /** Returns the current auth token and its decoded claims, if authenticated. */
  getAuth(): { token: string; decoded: Record<string, any> } | undefined {
    return this.getConvex().getAuth()
  }

  /** Whether this client has been closed. False before the inner client is created. */
  get closed(): boolean {
    return this.innerClient?.closed ?? false
  }

  /** Whether this client is disabled. False before the inner client is created. */
  get disabled(): boolean {
    return this.innerClient?.disabled ?? false
  }

  connectionState(): ConnectionState {
    return this.getConvex().connectionState()
  }

  subscribeToConnectionState(cb: (state: ConnectionState) => void): () => void {
    return this.getConvex().subscribeToConnectionState(cb)
  }

  async close() {
    await this.getConvex().close()
  }
}

export function createZodvexClient<R extends AnyRegistry>(
  registry: R,
  options: ZodvexClientOptions
): ZodvexClient<R> {
  return new ZodvexClient(registry, options)
}
