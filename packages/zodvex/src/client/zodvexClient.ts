import type { AuthTokenFetcher } from 'convex/browser'
import { ConvexClient } from 'convex/browser'
import type { FunctionReference } from 'convex/server'
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

  async query(ref: FunctionReference<'query', any, any, any>, args?: any): Promise<any> {
    const path = getFunctionName(ref)
    const entry = this.registry[path]
    const wireArgs = entry?.args && args ? stripUndefined(z.encode(entry.args, args)) : args
    const wireResult = await this.inner.query(ref, wireArgs)
    if (!entry?.returns) return wireResult
    return entry.returns.parse(wireResult)
  }

  async mutate(ref: FunctionReference<'mutation', any, any, any>, args?: any): Promise<any> {
    const path = getFunctionName(ref)
    const entry = this.registry[path]
    const wireArgs = entry?.args && args ? stripUndefined(z.encode(entry.args, args)) : args
    const wireResult = await this.inner.mutation(ref, wireArgs)
    if (!entry?.returns) return wireResult
    return entry.returns.parse(wireResult)
  }

  subscribe(
    ref: FunctionReference<'query', any, any, any>,
    args: any,
    callback: (result: any) => void
  ): () => void {
    const path = getFunctionName(ref)
    const entry = this.registry[path]
    const wireArgs = entry?.args && args ? stripUndefined(z.encode(entry.args, args)) : args

    return this.inner.onUpdate(ref, wireArgs, (wireResult: any) => {
      const decoded = entry?.returns ? entry.returns.parse(wireResult) : wireResult
      callback(decoded)
    })
  }

  setAuth(token: string | null) {
    // Wrap token string as an AuthTokenFetcher.
    // null → fetcher returns null, which tells Convex auth is cleared.
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
