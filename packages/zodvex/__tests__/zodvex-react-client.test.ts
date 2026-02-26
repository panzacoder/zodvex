import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { z } from 'zod'
import { zx } from '../src/zx'

// ---------------------------------------------------------------------------
// Mock convex/react — we simulate ConvexReactClient behaviour without a real
// Convex backend or WebSocket connection.
// ---------------------------------------------------------------------------

let mockQueryImpl: ((ref: any, args: any) => any) | undefined
let mockMutationImpl: ((ref: any, args: any) => any) | undefined
let mockActionImpl: ((ref: any, args: any) => any) | undefined
let mockWatchQueryImpl:
  | ((ref: any, args: any, opts: any) => { onUpdate: any; localQueryResult: any; journal: any })
  | undefined
let mockSetAuthCalls: { fetchToken: any; onChange: any }[] = []
let mockClearAuthCalled = false
let mockCloseCalled = false
let mockConnectionStateCalls = 0
let mockSubscribeToConnectionStateCb: any = null

class MockConvexReactClient {
  private _url: string
  constructor(address: string) {
    this._url = address
  }

  get url(): string {
    return this._url
  }

  async query(ref: any, args: any) {
    if (mockQueryImpl) return mockQueryImpl(ref, args)
    return args
  }

  async mutation(ref: any, args: any) {
    if (mockMutationImpl) return mockMutationImpl(ref, args)
    return args
  }

  async action(ref: any, args: any) {
    if (mockActionImpl) return mockActionImpl(ref, args)
    return args
  }

  watchQuery(ref: any, args: any, opts?: any) {
    if (mockWatchQueryImpl) return mockWatchQueryImpl(ref, args, opts)
    return {
      onUpdate: (_cb: () => void) => () => {
        /* noop */
      },
      localQueryResult: () => undefined,
      journal: () => undefined
    }
  }

  setAuth(fetchToken: any, onChange?: any) {
    mockSetAuthCalls.push({ fetchToken, onChange })
  }

  clearAuth() {
    mockClearAuthCalled = true
  }

  async close() {
    mockCloseCalled = true
  }

  connectionState() {
    mockConnectionStateCalls++
    return { isConnected: true, hasInflightRequests: false }
  }

  subscribeToConnectionState(cb: any) {
    mockSubscribeToConnectionStateCb = cb
    return () => {
      mockSubscribeToConnectionStateCb = null
    }
  }
}

mock.module('convex/react', () => ({
  ConvexReactClient: MockConvexReactClient,
  // Include useQuery/useMutation stubs so this mock doesn't break
  // react-hooks.test.ts when both files run in the same bun process.
  useQuery: () => undefined,
  useMutation: () => async () => ({})
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
const { ZodvexReactClient, createZodvexReactClient } = await import(
  '../src/react/zodvexReactClient'
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fake FunctionReference with a _testPath property */
function fakeRef(path: string) {
  return { _testPath: path } as any
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

describe('ZodvexReactClient', () => {
  let client: InstanceType<typeof ZodvexReactClient>

  beforeEach(() => {
    mockQueryImpl = undefined
    mockMutationImpl = undefined
    mockActionImpl = undefined
    mockWatchQueryImpl = undefined
    mockSetAuthCalls = []
    mockClearAuthCalled = false
    mockCloseCalled = false
    mockConnectionStateCalls = 0
    mockSubscribeToConnectionStateCb = null
    client = createZodvexReactClient(registry as any, { url: 'https://test.convex.cloud' })
  })

  // ---- constructor --------------------------------------------------------

  describe('constructor', () => {
    it('creates a new ConvexReactClient from url', () => {
      const c = createZodvexReactClient(registry as any, { url: 'https://test.convex.cloud' })
      expect(c).toBeInstanceOf(ZodvexReactClient)
      expect(c.convex).toBeInstanceOf(MockConvexReactClient)
    })

    it('wraps an existing ConvexReactClient without creating a new one', () => {
      const existingClient = new (MockConvexReactClient as any)('https://existing.convex.cloud')
      const c = new ZodvexReactClient(registry as any, { client: existingClient })
      expect(c.convex).toBe(existingClient)
    })

    it('returns ZodvexReactClient instance from factory', () => {
      const c = createZodvexReactClient(registry as any, { url: 'https://test.convex.cloud' })
      expect(c).toBeInstanceOf(ZodvexReactClient)
    })
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
  })

  // ---- mutation -----------------------------------------------------------

  describe('mutation', () => {
    it('encodes args and decodes results', async () => {
      const dueDate = new Date('2026-06-15T00:00:00Z')
      const ts = 1700000000000
      let capturedArgs: any = null

      mockMutationImpl = (_ref: any, args: any) => {
        capturedArgs = args
        return { _id: 'new2', title: 'Created', createdAt: ts }
      }

      const result = await client.mutation(fakeRef('tasks:create'), {
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

      const result = await client.mutation(fakeRef('plain:noCodec'), { raw: 'data' })

      expect(capturedArgs).toEqual({ raw: 'data' })
      expect(result).toEqual(raw)
    })
  })

  // ---- action -------------------------------------------------------------

  describe('action', () => {
    it('encodes args and decodes results', async () => {
      const dueDate = new Date('2026-06-15T00:00:00Z')
      const ts = 1700000000000
      let capturedArgs: any = null

      mockActionImpl = (_ref: any, args: any) => {
        capturedArgs = args
        return { _id: 'act1', title: 'Action result', createdAt: ts }
      }

      const result = await client.action(fakeRef('tasks:create'), {
        title: 'Action result',
        dueAt: dueDate
      })

      // Args should be encoded: Date -> timestamp number
      expect(capturedArgs.title).toBe('Action result')
      expect(typeof capturedArgs.dueAt).toBe('number')
      expect(capturedArgs.dueAt).toBe(dueDate.getTime())

      // Return should be decoded: number -> Date
      expect(result.createdAt).toBeInstanceOf(Date)
      expect(result.createdAt.getTime()).toBe(ts)
    })

    it('passes through when function has no schemas', async () => {
      const raw = { result: 'unchanged' }
      let capturedArgs: any = null

      mockActionImpl = (_ref: any, args: any) => {
        capturedArgs = args
        return raw
      }

      const result = await client.action(fakeRef('plain:noCodec'), { raw: 'data' })

      expect(capturedArgs).toEqual({ raw: 'data' })
      expect(result).toEqual(raw)
    })
  })

  // ---- watchQuery ---------------------------------------------------------

  describe('watchQuery', () => {
    it('decodes localQueryResult via codec (number -> Date)', () => {
      const ts = 1700000000000
      mockWatchQueryImpl = () => ({
        onUpdate: (_cb: () => void) => () => {
          /* noop */
        },
        localQueryResult: () => [{ _id: 'w1', title: 'Watched', createdAt: ts }],
        journal: () => undefined
      })

      const watch = client.watchQuery(fakeRef('tasks:list'))
      const result = watch.localQueryResult()

      expect(result).toHaveLength(1)
      expect(result[0].createdAt).toBeInstanceOf(Date)
      expect(result[0].createdAt.getTime()).toBe(ts)
    })

    it('returns undefined when localQueryResult is undefined (loading)', () => {
      mockWatchQueryImpl = () => ({
        onUpdate: (_cb: () => void) => () => {
          /* noop */
        },
        localQueryResult: () => undefined,
        journal: () => undefined
      })

      const watch = client.watchQuery(fakeRef('tasks:list'))
      const result = watch.localQueryResult()
      expect(result).toBeUndefined()
    })

    it('memoizes by wire reference identity', () => {
      const wireData = [{ _id: 'w2', title: 'Memoized', createdAt: 1700000000000 }]
      mockWatchQueryImpl = () => ({
        onUpdate: (_cb: () => void) => () => {
          /* noop */
        },
        localQueryResult: () => wireData, // same reference every time
        journal: () => undefined
      })

      const watch = client.watchQuery(fakeRef('tasks:list'))
      const result1 = watch.localQueryResult()
      const result2 = watch.localQueryResult()

      // Same wire reference -> same decoded reference (memoized)
      expect(result1).toBe(result2)
    })

    it('re-decodes when wire reference changes', () => {
      let callCount = 0
      const wire1 = [{ _id: 'w3', title: 'First', createdAt: 1700000000000 }]
      const wire2 = [{ _id: 'w3', title: 'Second', createdAt: 1800000000000 }]

      mockWatchQueryImpl = () => ({
        onUpdate: (_cb: () => void) => () => {
          /* noop */
        },
        localQueryResult: () => {
          callCount++
          return callCount === 1 ? wire1 : wire2
        },
        journal: () => undefined
      })

      const watch = client.watchQuery(fakeRef('tasks:list'))
      const result1 = watch.localQueryResult()
      const result2 = watch.localQueryResult()

      // Different wire references -> re-decoded
      expect(result1).not.toBe(result2)
      expect(result1[0].title).toBe('First')
      expect(result2[0].title).toBe('Second')
      expect(result2[0].createdAt).toBeInstanceOf(Date)
      expect(result2[0].createdAt.getTime()).toBe(1800000000000)
    })

    it('encodes args before passing to inner watchQuery', () => {
      const dueDate = new Date('2026-06-15T00:00:00Z')
      let capturedArgs: any = null

      mockWatchQueryImpl = (_ref: any, args: any) => {
        capturedArgs = args
        return {
          onUpdate: (_cb: () => void) => () => {
            /* noop */
          },
          localQueryResult: () => undefined,
          journal: () => undefined
        }
      }

      client.watchQuery(fakeRef('tasks:create'), { title: 'Watch task', dueAt: dueDate })

      expect(capturedArgs).toBeDefined()
      expect(capturedArgs.title).toBe('Watch task')
      expect(typeof capturedArgs.dueAt).toBe('number')
      expect(capturedArgs.dueAt).toBe(dueDate.getTime())
    })

    it('delegates onUpdate unchanged', () => {
      let onUpdateCb: (() => void) | null = null
      let unsubCalled = false

      mockWatchQueryImpl = () => ({
        onUpdate: (cb: () => void) => {
          onUpdateCb = cb
          return () => {
            unsubCalled = true
          }
        },
        localQueryResult: () => undefined,
        journal: () => undefined
      })

      const watch = client.watchQuery(fakeRef('tasks:list'))
      let notified = false
      const unsub = watch.onUpdate(() => {
        notified = true
      })

      // Trigger the callback via the inner watch
      expect(onUpdateCb).not.toBeNull()
      onUpdateCb?.()
      expect(notified).toBe(true)

      // Unsubscribe
      unsub()
      expect(unsubCalled).toBe(true)
    })

    it('delegates journal unchanged', () => {
      const journalData = { definitionId: 'test', cursor: null }
      mockWatchQueryImpl = () => ({
        onUpdate: (_cb: () => void) => () => {
          /* noop */
        },
        localQueryResult: () => undefined,
        journal: () => journalData
      })

      const watch = client.watchQuery(fakeRef('tasks:list'))
      expect(watch.journal()).toBe(journalData)
    })
  })

  // ---- pass-through methods -----------------------------------------------

  describe('pass-through methods', () => {
    it('delegates setAuth to inner ConvexReactClient', () => {
      const fetchToken = async () => 'test-token'
      const onChange = () => {
        /* noop */
      }
      client.setAuth(fetchToken, onChange)
      expect(mockSetAuthCalls).toHaveLength(1)
      expect(mockSetAuthCalls[0].fetchToken).toBe(fetchToken)
      expect(mockSetAuthCalls[0].onChange).toBe(onChange)
    })

    it('delegates clearAuth to inner ConvexReactClient', () => {
      client.clearAuth()
      expect(mockClearAuthCalled).toBe(true)
    })

    it('delegates close to inner ConvexReactClient', async () => {
      await client.close()
      expect(mockCloseCalled).toBe(true)
    })

    it('exposes the url from inner ConvexReactClient', () => {
      expect(client.url).toBe('https://test.convex.cloud')
    })

    it('delegates connectionState to inner ConvexReactClient', () => {
      const state = client.connectionState()
      expect(mockConnectionStateCalls).toBe(1)
      expect(state).toEqual({ isConnected: true, hasInflightRequests: false })
    })

    it('delegates subscribeToConnectionState to inner ConvexReactClient', () => {
      const cb = () => {
        /* noop */
      }
      const unsub = client.subscribeToConnectionState(cb)
      expect(mockSubscribeToConnectionStateCb).toBe(cb)
      expect(typeof unsub).toBe('function')

      unsub()
      expect(mockSubscribeToConnectionStateCb).toBeNull()
    })
  })

  // ---- .convex accessor ---------------------------------------------------

  describe('.convex accessor', () => {
    it('exposes the inner ConvexReactClient', () => {
      expect(client.convex).toBeDefined()
      expect(client.convex).toBeInstanceOf(MockConvexReactClient)
    })
  })
})
