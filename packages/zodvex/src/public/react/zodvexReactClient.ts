import type { AuthTokenFetcher, ConnectionState } from 'convex/browser'
import type { Watch, WatchQueryOptions } from 'convex/react'
import { ConvexReactClient } from 'convex/react'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import type { BoundaryHelpersOptions } from '../../boundaryHelpers'
import { createBoundaryHelpers } from '../../boundaryHelpers'
import type { AnyRegistry } from '../../types'

export type ZodvexReactClientOptions = ({ url: string } | { client: ConvexReactClient }) &
  BoundaryHelpersOptions

export class ZodvexReactClient<R extends AnyRegistry = AnyRegistry> {
  readonly convex: ConvexReactClient
  private codec: ReturnType<typeof createBoundaryHelpers>

  constructor(registry: R, options: ZodvexReactClientOptions) {
    this.codec = createBoundaryHelpers(registry, { onDecodeError: options.onDecodeError })
    if ('client' in options) {
      this.convex = options.client
    } else {
      this.convex = new ConvexReactClient(options.url)
    }
  }

  // ---------------------------------------------------------------------------
  // Data methods — codec-wrapped
  // ---------------------------------------------------------------------------

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

  async mutation<M extends FunctionReference<'mutation', any, any, any>>(
    ref: M,
    args: M['_args']
  ): Promise<M['_returnType']> {
    const wireResult = await this.convex.mutation(
      ref,
      this.codec.encodeArgs(ref, args) as FunctionArgs<M>
    )
    return this.codec.decodeResult(ref, wireResult)
  }

  async action<A extends FunctionReference<'action', any, any, any>>(
    ref: A,
    args: A['_args']
  ): Promise<A['_returnType']> {
    const wireResult = await this.convex.action(
      ref,
      this.codec.encodeArgs(ref, args) as FunctionArgs<A>
    )
    return this.codec.decodeResult(ref, wireResult)
  }

  watchQuery<Q extends FunctionReference<'query', any, any, any>>(
    ref: Q,
    args: Q['_args'],
    options?: WatchQueryOptions
  ): Watch<Q['_returnType']> {
    const wireArgs = this.codec.encodeArgs(ref, args) as FunctionArgs<Q>
    const innerWatch = this.convex.watchQuery(ref, wireArgs, options as any)

    // Memoize by wire reference identity to avoid redundant Zod parse.
    // Convex creates a new object per server transition via jsonToConvex()
    // in remote_query_set.ts, but returns the same reference for repeated
    // reads within a single transition window.
    // See: convex/src/browser/sync/optimistic_updates_impl.ts
    //   TODO(CX-733) — Convex internal tracker for client-side result
    //   memoization (not yet public).
    let lastWire: unknown
    let lastDecoded: unknown

    return {
      onUpdate: (cb: () => void) => innerWatch.onUpdate(cb),
      localQueryResult: () => {
        const wire = innerWatch.localQueryResult()
        if (wire === lastWire) return lastDecoded
        lastWire = wire
        lastDecoded = wire === undefined ? undefined : this.codec.decodeResult(ref, wire)
        return lastDecoded
      },
      journal: () => innerWatch.journal()
    }
  }

  // ---------------------------------------------------------------------------
  // Pass-through methods — no codec needed
  // ---------------------------------------------------------------------------

  setAuth(fetchToken: AuthTokenFetcher, onChange?: (isAuthenticated: boolean) => void): void {
    this.convex.setAuth(fetchToken, onChange)
  }

  clearAuth(): void {
    this.convex.clearAuth()
  }

  async close(): Promise<void> {
    await this.convex.close()
  }

  get url(): string {
    return this.convex.url
  }

  connectionState() {
    return this.convex.connectionState()
  }

  subscribeToConnectionState(cb: (state: ConnectionState) => void): () => void {
    return this.convex.subscribeToConnectionState(cb)
  }
}

export function createZodvexReactClient<R extends AnyRegistry>(
  registry: R,
  options: ZodvexReactClientOptions
): ZodvexReactClient<R> {
  return new ZodvexReactClient(registry, options)
}
