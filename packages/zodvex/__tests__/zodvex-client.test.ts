import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { zx } from '../src/internal/zx'

// ---------------------------------------------------------------------------
// Mock convex/browser — we simulate ConvexClient behaviour without a real
// Convex backend or WebSocket connection.
// ---------------------------------------------------------------------------

// Shared state + mock class — vi.hoisted runs before vi.mock
const { mocks, MockConvexClient } = vi.hoisted(() => {
  const state = {
    queryImpl: undefined as ((ref: any, args: any) => any) | undefined,
    mutationImpl: undefined as ((ref: any, args: any) => any) | undefined,
    onUpdateImpl: undefined as ((ref: any, args: any, cb: any) => () => void) | undefined,
    // setAuth receives an AuthTokenFetcher (async function), not a raw string.
    // We capture the fetchers so tests can resolve them.
    setAuthFetchers: [] as any[],
    closeCalled: false
  }

  class MockConvexClient {
    url: string
    constructor(url: string) {
      this.url = url
    }

    async query(ref: any, args: any) {
      if (state.queryImpl) return state.queryImpl(ref, args)
      return args
    }

    async mutation(ref: any, args: any) {
      if (state.mutationImpl) return state.mutationImpl(ref, args)
      return args
    }

    onUpdate(ref: any, args: any, callback: (result: any) => void): () => void {
      if (state.onUpdateImpl) return state.onUpdateImpl(ref, args, callback)
      return () => {
        /* no-op unsubscribe */
      }
    }

    setAuth(fetchToken: any) {
      state.setAuthFetchers.push(fetchToken)
    }

    async close() {
      state.closeCalled = true
    }
  }

  return { mocks: state, MockConvexClient }
})

vi.mock('convex/browser', () => ({
  ConvexClient: MockConvexClient
}))

// Import AFTER mocks are set up (vitest hoists vi.mock)
const { ZodvexClient, createZodvexClient } = await import('../src/client/zodvexClient')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const functionNameSymbol = Symbol.for('functionName')

/** Create a fake FunctionReference with the well-known functionName symbol */
function fakeRef(path: string) {
  return { [functionNameSymbol]: path } as any
}

/** Resolve the last captured AuthTokenFetcher to get its token value */
async function lastTokenValue(): Promise<string | null | undefined> {
  const fetcher = mocks.setAuthFetchers[mocks.setAuthFetchers.length - 1]
  if (!fetcher) return undefined
  return fetcher({ forceRefreshToken: false })
}

// ---------------------------------------------------------------------------
// Registry with zx.date() returns codec and args schema
// ---------------------------------------------------------------------------

const taskReturnsSchema = z.object({
  _id: z.string(),
  title: z.string(),
  createdAt: zx.date()
})

const taskArgsSchema = z.object({
  title: z.string(),
  dueAt: zx.date()
})

const registry = {
  'tasks:list': {
    returns: z.array(taskReturnsSchema)
  },
  'tasks:create': {
    args: taskArgsSchema,
    returns: taskReturnsSchema
  },
  'plain:noCodec': {
    // No schemas — should passthrough
  }
} as const

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ZodvexClient', () => {
  let client: InstanceType<typeof ZodvexClient>

  beforeEach(() => {
    mocks.queryImpl = undefined
    mocks.mutationImpl = undefined
    mocks.onUpdateImpl = undefined
    mocks.setAuthFetchers = []
    mocks.closeCalled = false
    client = createZodvexClient(registry as any, { url: 'https://test.convex.cloud' })
  })

  // ---- query --------------------------------------------------------------

  describe('query', () => {
    it('decodes wire data through the returns schema (number -> Date)', async () => {
      const now = Date.now()
      mocks.queryImpl = () => [{ _id: 'abc123', title: 'Write tests', createdAt: now }]

      const result = await client.query(fakeRef('tasks:list'))

      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('Write tests')
      expect(result[0].createdAt).toBeInstanceOf(Date)
      expect(result[0].createdAt.getTime()).toBe(now)
    })

    it('encodes args through the args schema (Date -> number)', async () => {
      const dueDate = new Date('2026-06-15T00:00:00Z')
      let capturedArgs: any = null

      mocks.queryImpl = (_ref: any, args: any) => {
        capturedArgs = args
        return { _id: 'new1', title: args.title, createdAt: Date.now() }
      }

      await client.query(fakeRef('tasks:create'), { title: 'New task', dueAt: dueDate })

      expect(capturedArgs).toBeDefined()
      expect(capturedArgs.title).toBe('New task')
      expect(typeof capturedArgs.dueAt).toBe('number')
      expect(capturedArgs.dueAt).toBe(dueDate.getTime())
    })

    it('passes through unchanged when function is not in the registry', async () => {
      const raw = { foo: 'bar' }
      mocks.queryImpl = () => raw

      const result = await client.query(fakeRef('unknown:fn'), { some: 'args' })
      expect(result).toEqual(raw)
    })

    it('passes through unchanged when registry entry has no returns schema', async () => {
      const raw = { data: 42 }
      mocks.queryImpl = () => raw

      const result = await client.query(fakeRef('plain:noCodec'))
      expect(result).toEqual(raw)
    })

    it('passes args unchanged when no args schema exists', async () => {
      let capturedArgs: any = null
      mocks.queryImpl = (_ref: any, args: any) => {
        capturedArgs = args
        return []
      }

      await client.query(fakeRef('tasks:list'), { raw: 'passthrough' })
      expect(capturedArgs).toEqual({ raw: 'passthrough' })
    })
  })

  // ---- mutate -------------------------------------------------------------

  describe('mutate', () => {
    it('encodes args and decodes results', async () => {
      const dueDate = new Date('2026-06-15T00:00:00Z')
      const ts = 1700000000000
      let capturedArgs: any = null

      mocks.mutationImpl = (_ref: any, args: any) => {
        capturedArgs = args
        return { _id: 'new2', title: 'Created', createdAt: ts }
      }

      const result = await client.mutate(fakeRef('tasks:create'), {
        title: 'Created',
        dueAt: dueDate
      })

      // Args should be encoded: Date -> timestamp number
      expect(capturedArgs.title).toBe('Created')
      expect(typeof capturedArgs.dueAt).toBe('number')
      expect(capturedArgs.dueAt).toBe(dueDate.getTime())

      // Return should be decoded: number -> Date
      expect(result.createdAt).toBeInstanceOf(Date)
      expect(result.createdAt.getTime()).toBe(ts)
    })

    it('passes through when function has no schemas', async () => {
      const raw = { result: 'unchanged' }
      let capturedArgs: any = null

      mocks.mutationImpl = (_ref: any, args: any) => {
        capturedArgs = args
        return raw
      }

      const result = await client.mutate(fakeRef('plain:noCodec'), { raw: 'data' })

      expect(capturedArgs).toEqual({ raw: 'data' })
      expect(result).toEqual(raw)
    })

    it('strips undefined values from encoded args', async () => {
      const optionalArgsSchema = z.object({
        title: z.string(),
        description: z.string().optional()
      })
      const optionalRegistry = {
        'notes:create': { args: optionalArgsSchema }
      }
      const optClient = createZodvexClient(optionalRegistry, {
        url: 'https://test.convex.cloud'
      })

      let capturedArgs: any = null
      mocks.mutationImpl = (_ref: any, args: any) => {
        capturedArgs = args
        return {}
      }

      await optClient.mutate(fakeRef('notes:create'), { title: 'Hello' })

      expect(capturedArgs).toBeDefined()
      expect(capturedArgs.title).toBe('Hello')
      expect('description' in capturedArgs).toBe(false)
    })
  })

  // ---- subscribe ----------------------------------------------------------

  describe('subscribe', () => {
    it('decodes wire data in the callback (number -> Date)', () => {
      const ts = 1700000000000
      let decodedResult: any = null

      mocks.onUpdateImpl = (_ref: any, _args: any, callback: any) => {
        // Simulate server pushing wire data
        callback([{ _id: 'sub1', title: 'Subscribed', createdAt: ts }])
        return () => {
          /* no-op unsubscribe */
        }
      }

      client.subscribe(fakeRef('tasks:list'), {}, (result: any) => {
        decodedResult = result
      })

      expect(decodedResult).toBeDefined()
      expect(decodedResult).toHaveLength(1)
      expect(decodedResult[0].createdAt).toBeInstanceOf(Date)
      expect(decodedResult[0].createdAt.getTime()).toBe(ts)
    })

    it('encodes subscribe args (Date -> number)', () => {
      const dueDate = new Date('2026-06-15T00:00:00Z')
      let capturedArgs: any = null

      mocks.onUpdateImpl = (_ref: any, args: any, _callback: any) => {
        capturedArgs = args
        return () => {
          /* no-op unsubscribe */
        }
      }

      client.subscribe(fakeRef('tasks:create'), { title: 'Sub task', dueAt: dueDate }, () => {
        /* no-op unsubscribe */
      })

      expect(capturedArgs).toBeDefined()
      expect(typeof capturedArgs.dueAt).toBe('number')
      expect(capturedArgs.dueAt).toBe(dueDate.getTime())
    })

    it('returns an unsubscribe function', () => {
      let unsubCalled = false
      mocks.onUpdateImpl = () => {
        return () => {
          unsubCalled = true
        }
      }

      const unsub = client.subscribe(fakeRef('tasks:list'), {}, () => {
        /* no-op unsubscribe */
      })
      expect(typeof unsub).toBe('function')

      unsub()
      expect(unsubCalled).toBe(true)
    })

    it('passes through unchanged when function is not in the registry', () => {
      const raw = { foo: 'bar' }
      let receivedResult: any = null

      mocks.onUpdateImpl = (_ref: any, _args: any, callback: any) => {
        callback(raw)
        return () => {
          /* no-op unsubscribe */
        }
      }

      client.subscribe(fakeRef('unknown:fn'), {}, (result: any) => {
        receivedResult = result
      })

      expect(receivedResult).toEqual(raw)
    })
  })

  // ---- setAuth & close ----------------------------------------------------

  describe('setAuth and close', () => {
    it('delegates setAuth to inner ConvexClient with a token fetcher', async () => {
      client.setAuth('test-token-123')
      // setAuth wraps the token in an AuthTokenFetcher
      expect(mocks.setAuthFetchers).toHaveLength(1)
      expect(typeof mocks.setAuthFetchers[0]).toBe('function')
      // Resolving the fetcher should yield the token
      const token = await lastTokenValue()
      expect(token).toBe('test-token-123')
    })

    it('delegates setAuth(null) as a fetcher returning null', async () => {
      client.setAuth(null)
      expect(mocks.setAuthFetchers).toHaveLength(1)
      expect(typeof mocks.setAuthFetchers[0]).toBe('function')
      const token = await lastTokenValue()
      expect(token).toBe(null)
    })

    it('delegates close to inner ConvexClient', async () => {
      await client.close()
      expect(mocks.closeCalled).toBe(true)
    })
  })

  // ---- constructor --------------------------------------------------------

  describe('constructor', () => {
    it('sets auth token when provided in options', async () => {
      mocks.setAuthFetchers = []
      createZodvexClient(registry as any, {
        url: 'https://test.convex.cloud',
        token: 'initial-token'
      })
      expect(mocks.setAuthFetchers).toHaveLength(1)
      const token = await lastTokenValue()
      expect(token).toBe('initial-token')
    })

    it('does not set auth when token is null', () => {
      mocks.setAuthFetchers = []
      createZodvexClient(registry as any, {
        url: 'https://test.convex.cloud',
        token: null
      })
      // Should not have called setAuth
      expect(mocks.setAuthFetchers).toHaveLength(0)
    })

    it('does not set auth when token is omitted', () => {
      mocks.setAuthFetchers = []
      createZodvexClient(registry as any, { url: 'https://test.convex.cloud' })
      expect(mocks.setAuthFetchers).toHaveLength(0)
    })
  })

  // ---- constructor with existing client ------------------------------------

  describe('constructor with existing client', () => {
    it('wraps an existing ConvexClient without creating a new one', () => {
      const existingClient = new (MockConvexClient as any)('https://existing.convex.cloud')
      const zc = new ZodvexClient(registry as any, { client: existingClient })
      expect(zc.convex).toBe(existingClient)
    })

    it('uses the existing client for queries', async () => {
      const existingClient = new (MockConvexClient as any)('https://existing.convex.cloud')
      const zc = new ZodvexClient(registry as any, { client: existingClient })
      const now = Date.now()
      mocks.queryImpl = () => [{ _id: 'abc', title: 'Test', createdAt: now }]
      const result = await zc.query(fakeRef('tasks:list'))
      expect(result[0].createdAt).toBeInstanceOf(Date)
    })
  })

  // ---- .convex accessor ---------------------------------------------------

  describe('.convex accessor', () => {
    it('exposes the inner ConvexClient', () => {
      expect(client.convex).toBeDefined()
      expect(client.convex).toBeInstanceOf(MockConvexClient)
    })
  })

  // ---- createZodvexClient factory -----------------------------------------

  describe('createZodvexClient', () => {
    it('returns a ZodvexClient instance', () => {
      const c = createZodvexClient(registry as any, { url: 'https://test.convex.cloud' })
      expect(c).toBeInstanceOf(ZodvexClient)
    })
  })
})
