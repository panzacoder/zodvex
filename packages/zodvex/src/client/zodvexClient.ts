import type { AuthTokenFetcher } from 'convex/browser'
import { ConvexClient } from 'convex/browser'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { getFunctionName } from 'convex/server'
import { z } from 'zod'
import type { AnyRegistry } from '../types'
import { stripUndefined } from '../utils'

export type ZodvexClientOptions = {
  url: string
  token?: string | null
}

/** Wrap a static token string as an AuthTokenFetcher for ConvexClient */
function tokenToFetcher(token: string): AuthTokenFetcher {
  return async () => token
}

export class ZodvexClient<R extends AnyRegistry = AnyRegistry> {
  private inner: ConvexClient
  private registry: R

  constructor(registry: R, options: ZodvexClientOptions) {
    this.registry = registry
    this.inner = new ConvexClient(options.url)
    if (options.token) this.inner.setAuth(tokenToFetcher(options.token))
  }

  private encodeArgs(ref: FunctionReference<any, any, any, any>, args: any): any {
    const path = getFunctionName(ref)
    const entry = this.registry[path]
    return entry?.args && args ? stripUndefined(z.encode(entry.args, args)) : args
  }

  private decodeResult(ref: FunctionReference<any, any, any, any>, wireResult: any): any {
    const path = getFunctionName(ref)
    const entry = this.registry[path]
    if (!entry?.returns) return wireResult
    return entry.returns.parse(wireResult)
  }

  async query<Q extends FunctionReference<'query', any, any, any>>(
    ref: Q,
    args: Q['_args']
  ): Promise<Q['_returnType']> {
    const wireResult = await this.inner.query(ref, this.encodeArgs(ref, args) as FunctionArgs<Q>)
    return this.decodeResult(ref, wireResult)
  }

  async mutate<M extends FunctionReference<'mutation', any, any, any>>(
    ref: M,
    args: M['_args']
  ): Promise<M['_returnType']> {
    const wireResult = await this.inner.mutation(ref, this.encodeArgs(ref, args) as FunctionArgs<M>)
    return this.decodeResult(ref, wireResult)
  }

  subscribe<Q extends FunctionReference<'query', any, any, any>>(
    ref: Q,
    args: Q['_args'],
    callback: (result: Q['_returnType']) => void
  ): () => void {
    const wireArgs = this.encodeArgs(ref, args) as FunctionArgs<Q>
    return this.inner.onUpdate(ref, wireArgs, (wireResult: FunctionReturnType<Q>) => {
      callback(this.decodeResult(ref, wireResult))
    })
  }

  setAuth(token: string | null) {
    this.inner.setAuth(async () => token)
  }

  async close() {
    await this.inner.close()
  }
}

export function createZodvexClient<R extends AnyRegistry>(
  registry: R,
  options: ZodvexClientOptions
): ZodvexClient<R> {
  return new ZodvexClient(registry, options)
}
