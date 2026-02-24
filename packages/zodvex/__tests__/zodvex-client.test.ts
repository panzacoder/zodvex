import { describe, expect, it, mock, beforeEach } from 'bun:test'
import { z } from 'zod'
import { zx } from '../src/zx'

// ---------------------------------------------------------------------------
// Mock convex/browser — we simulate ConvexClient behaviour without a real
// Convex backend or WebSocket connection.
// ---------------------------------------------------------------------------

let mockQueryImpl: ((ref: any, args: any) => any) | undefined
let mockMutationImpl: ((ref: any, args: any) => any) | undefined
let mockOnUpdateImpl: ((ref: any, args: any, cb: any) => () => void) | undefined
// setAuth receives an AuthTokenFetcher (async function), not a raw string.
// We capture the fetchers so tests can resolve them.
let mockSetAuthFetchers: any[] = []
let mockCloseCalled = false

class MockConvexClient {
  constructor(public url: string) {}

  async query(ref: any, args: any) {
    if (mockQueryImpl) return mockQueryImpl(ref, args)
    return args
  }

  async mutation(ref: any, args: any) {
    if (mockMutationImpl) return mockMutationImpl(ref, args)
    return args
  }

  onUpdate(ref: any, args: any, callback: (result: any) => void): () => void {
    if (mockOnUpdateImpl) return mockOnUpdateImpl(ref, args, callback)
    return () => {}
  }

  setAuth(fetchToken: any) {
    mockSetAuthFetchers.push(fetchToken)
  }

  async close() {
    mockCloseCalled = true
  }
}

mock.module('convex/browser', () => ({
  ConvexClient: MockConvexClient
}))

// Mock convex/server — we need getFunctionName to work
mock.module('convex/server', () => ({
  getFunctionName: (ref: any) => {
    // In real code, getFunctionName reads Symbol.for("functionName").
    // For tests, we use a simple _testPath property on our fake refs.
    return ref._testPath
  }
}))

// Import AFTER mocks are set up (bun:test hoists mock.module)
const { ZodvexClient, createZodvexClient } = await import('../src/client/zodvexClient')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fake FunctionReference with a _testPath property */
function fakeRef(path: string) {
  return { _testPath: path } as any
}

/** Resolve the last captured AuthTokenFetcher to get its token value */
async function lastTokenValue(): Promise<string | null | undefined> {
  const fetcher = mockSetAuthFetchers[mockSetAuthFetchers.length - 1]
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
    mockQueryImpl = undefined
    mockMutationImpl = undefined
    mockOnUpdateImpl = undefined
    mockSetAuthFetchers = []
    mockCloseCalled = false
    client = createZodvexClient(registry as any, { url: 'https://test.convex.cloud' })
  })

  // ---- query --------------------------------------------------------------

  describe('query', () => {
    it('decodes wire data through the returns schema (number -> Date)', async () => {
      const now = Date.now()
      mockQueryImpl = () => [{ _id: 'abc123', title: 'Write tests', createdAt: now }]

      const result = await client.query(fakeRef('tasks:list'))

      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('Write tests')
      expect(result[0].createdAt).toBeInstanceOf(Date)
      expect(result[0].createdAt.getTime()).toBe(now)
    })

    it('encodes args through the args schema (Date -> number)', async () => {
      const dueDate = new Date('2026-06-15T00:00:00Z')
      let capturedArgs: any = null

      mockQueryImpl = (_ref: any, args: any) => {
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
      mockQueryImpl = () => raw

      const result = await client.query(fakeRef('unknown:fn'), { some: 'args' })
      expect(result).toEqual(raw)
    })

    it('passes through unchanged when registry entry has no returns schema', async () => {
      const raw = { data: 42 }
      mockQueryImpl = () => raw

      const result = await client.query(fakeRef('plain:noCodec'))
      expect(result).toEqual(raw)
    })

    it('passes args unchanged when no args schema exists', async () => {
      let capturedArgs: any = null
      mockQueryImpl = (_ref: any, args: any) => {
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

      mockMutationImpl = (_ref: any, args: any) => {
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

      mockMutationImpl = (_ref: any, args: any) => {
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
      mockMutationImpl = (_ref: any, args: any) => {
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

      mockOnUpdateImpl = (_ref: any, _args: any, callback: any) => {
        // Simulate server pushing wire data
        callback([{ _id: 'sub1', title: 'Subscribed', createdAt: ts }])
        return () => {}
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

      mockOnUpdateImpl = (_ref: any, args: any, _callback: any) => {
        capturedArgs = args
        return () => {}
      }

      client.subscribe(fakeRef('tasks:create'), { title: 'Sub task', dueAt: dueDate }, () => {})

      expect(capturedArgs).toBeDefined()
      expect(typeof capturedArgs.dueAt).toBe('number')
      expect(capturedArgs.dueAt).toBe(dueDate.getTime())
    })

    it('returns an unsubscribe function', () => {
      let unsubCalled = false
      mockOnUpdateImpl = () => {
        return () => {
          unsubCalled = true
        }
      }

      const unsub = client.subscribe(fakeRef('tasks:list'), {}, () => {})
      expect(typeof unsub).toBe('function')

      unsub()
      expect(unsubCalled).toBe(true)
    })

    it('passes through unchanged when function is not in the registry', () => {
      const raw = { foo: 'bar' }
      let receivedResult: any = null

      mockOnUpdateImpl = (_ref: any, _args: any, callback: any) => {
        callback(raw)
        return () => {}
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
      expect(mockSetAuthFetchers).toHaveLength(1)
      expect(typeof mockSetAuthFetchers[0]).toBe('function')
      // Resolving the fetcher should yield the token
      const token = await lastTokenValue()
      expect(token).toBe('test-token-123')
    })

    it('delegates setAuth(null) as a fetcher returning null', async () => {
      client.setAuth(null)
      expect(mockSetAuthFetchers).toHaveLength(1)
      expect(typeof mockSetAuthFetchers[0]).toBe('function')
      const token = await lastTokenValue()
      expect(token).toBe(null)
    })

    it('delegates close to inner ConvexClient', async () => {
      await client.close()
      expect(mockCloseCalled).toBe(true)
    })
  })

  // ---- constructor --------------------------------------------------------

  describe('constructor', () => {
    it('sets auth token when provided in options', async () => {
      mockSetAuthFetchers = []
      createZodvexClient(registry as any, {
        url: 'https://test.convex.cloud',
        token: 'initial-token'
      })
      expect(mockSetAuthFetchers).toHaveLength(1)
      const token = await lastTokenValue()
      expect(token).toBe('initial-token')
    })

    it('does not set auth when token is null', () => {
      mockSetAuthFetchers = []
      createZodvexClient(registry as any, {
        url: 'https://test.convex.cloud',
        token: null
      })
      // Should not have called setAuth
      expect(mockSetAuthFetchers).toHaveLength(0)
    })

    it('does not set auth when token is omitted', () => {
      mockSetAuthFetchers = []
      createZodvexClient(registry as any, { url: 'https://test.convex.cloud' })
      expect(mockSetAuthFetchers).toHaveLength(0)
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
