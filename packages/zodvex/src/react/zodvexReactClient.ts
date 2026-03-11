import type { AuthTokenFetcher } from 'convex/browser'
import { ConvexReactClient } from 'convex/react'
import type { FunctionReference, FunctionReturnType } from 'convex/server'
import type { BoundaryHelpersOptions } from '../boundaryHelpers'
import { createBoundaryHelpers } from '../boundaryHelpers'
import type { AnyRegistry } from '../types'

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

  async query(ref: any, ...args: any[]): Promise<any> {
    const wireArgs = this.codec.encodeArgs(ref, args[0])
    const wireResult = await this.convex.query(ref, wireArgs)
    return this.codec.decodeResult(ref, wireResult)
  }

  async mutation(ref: any, ...args: any[]): Promise<any> {
    const wireArgs = this.codec.encodeArgs(ref, args[0])
    const wireResult = await this.convex.mutation(ref, wireArgs)
    return this.codec.decodeResult(ref, wireResult)
  }

  async action(ref: any, ...args: any[]): Promise<any> {
    const wireArgs = this.codec.encodeArgs(ref, args[0])
    const wireResult = await this.convex.action(ref, wireArgs)
    return this.codec.decodeResult(ref, wireResult)
  }

  watchQuery(ref: any, ...argsAndOptions: any[]): any {
    const wireArgs = this.codec.encodeArgs(ref, argsAndOptions[0])
    const innerWatch = this.convex.watchQuery(ref, wireArgs, argsAndOptions[1])

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

  subscribeToConnectionState(cb: (state: any) => void): () => void {
    return this.convex.subscribeToConnectionState(cb)
  }
}

export function createZodvexReactClient<R extends AnyRegistry>(
  registry: R,
  options: ZodvexReactClientOptions
): ZodvexReactClient<R> {
  return new ZodvexReactClient(registry, options)
}
