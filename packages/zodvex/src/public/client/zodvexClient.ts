import type { AuthTokenFetcher } from 'convex/browser'
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
      client.setAuth(this.pendingAuthFetcher)
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
    args: M['_args']
  ): Promise<M['_returnType']> {
    const wireResult = await this.getConvex().mutation(
      ref,
      this.codec.encodeArgs(ref, args) as FunctionArgs<M>
    )
    return this.codec.decodeResult(ref, wireResult)
  }

  subscribe<Q extends FunctionReference<'query', any, any, any>>(
    ref: Q,
    args: Q['_args'],
    callback: (result: Q['_returnType']) => void
  ): () => void {
    const wireArgs = this.codec.encodeArgs(ref, args) as FunctionArgs<Q>
    return this.getConvex().onUpdate(ref, wireArgs, (wireResult: FunctionReturnType<Q>) => {
      callback(this.codec.decodeResult(ref, wireResult))
    })
  }

  setAuth(token: string | null) {
    const fetcher = async () => token
    this.pendingAuthFetcher = fetcher
    if (this.innerClient) {
      this.innerClient.setAuth(fetcher)
    }
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
