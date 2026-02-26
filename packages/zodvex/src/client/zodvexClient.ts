import type { AuthTokenFetcher } from 'convex/browser'
import { ConvexClient } from 'convex/browser'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { createCodecHelpers } from '../codecHelpers'
import type { AnyRegistry } from '../types'

export type ZodvexClientOptions = { url: string; token?: string | null } | { client: ConvexClient }

/** Wrap a static token string as an AuthTokenFetcher for ConvexClient */
function tokenToFetcher(token: string): AuthTokenFetcher {
  return async () => token
}

export class ZodvexClient<R extends AnyRegistry = AnyRegistry> {
  readonly convex: ConvexClient
  private codec: ReturnType<typeof createCodecHelpers>

  constructor(registry: R, options: ZodvexClientOptions) {
    this.codec = createCodecHelpers(registry)
    if ('client' in options) {
      this.convex = options.client
    } else {
      this.convex = new ConvexClient(options.url)
      if (options.token) this.convex.setAuth(tokenToFetcher(options.token))
    }
  }

  async query<Q extends FunctionReference<'query', any, any, any>>(
    ref: Q,
    args: Q['_args']
  ): Promise<Q['_returnType']> {
    const wireResult = await this.convex.query(
      ref,
      this.codec.encodeArgs(ref, args) as FunctionArgs<Q>
    )
    return this.codec.decodeResult(ref, wireResult)
  }

  async mutate<M extends FunctionReference<'mutation', any, any, any>>(
    ref: M,
    args: M['_args']
  ): Promise<M['_returnType']> {
    const wireResult = await this.convex.mutation(
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
    return this.convex.onUpdate(ref, wireArgs, (wireResult: FunctionReturnType<Q>) => {
      callback(this.codec.decodeResult(ref, wireResult))
    })
  }

  setAuth(token: string | null) {
    this.convex.setAuth(async () => token)
  }

  async close() {
    await this.convex.close()
  }
}

export function createZodvexClient<R extends AnyRegistry>(
  registry: R,
  options: ZodvexClientOptions
): ZodvexClient<R> {
  return new ZodvexClient(registry, options)
}
