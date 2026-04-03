import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { stripUndefined } from '../src/utils'
import { zx } from '../src/zx'

// ---------------------------------------------------------------------------
// Mock convex/react — we simulate useQuery and useMutation behaviour
// without requiring React or a real ConvexProvider.
// ---------------------------------------------------------------------------

// Shared state — vi.hoisted runs before vi.mock so the factory can reference it
const mocks = vi.hoisted(() => ({
  queryResult: undefined as any,
  queryArgs: undefined as any,
  mutateImpl: undefined as ((args: any) => any) | undefined
}))

vi.mock('convex/react', () => ({
  useQuery: (_ref: any, ...args: any[]) => {
    mocks.queryArgs = args[0]
    // Convex returns undefined for skipped queries
    if (args[0] === 'skip') return undefined
    return mocks.queryResult
  },
  useMutation: (_ref: any) => {
    // Return a function that simulates calling the server mutation
    return async (args: any) => {
      if (mocks.mutateImpl) return mocks.mutateImpl(args)
      return args
    }
  }
}))

// Import AFTER mocks are set up (vitest hoists vi.mock)
const { createZodvexHooks } = await import('../src/react/hooks')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const functionNameSymbol = Symbol.for('functionName')

/** Create a fake FunctionReference with the well-known functionName symbol */
function fakeRef(path: string) {
  return { [functionNameSymbol]: path } as any
}

// ---------------------------------------------------------------------------
// Registry with a zx.date() returns codec and an args schema
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

describe('createZodvexHooks', () => {
  const { useZodQuery, useZodMutation } = createZodvexHooks(registry as any)

  beforeEach(() => {
    mocks.queryResult = undefined
    mocks.queryArgs = undefined
    mocks.mutateImpl = undefined
  })

  // ---- useZodQuery --------------------------------------------------------

  describe('useZodQuery', () => {
    it('returns undefined when the query is still loading', () => {
      mocks.queryResult = undefined
      const result = useZodQuery(fakeRef('tasks:list'))
      expect(result).toBeUndefined()
    })

    it('decodes wire data through the returns schema (number -> Date)', () => {
      const now = Date.now()
      mocks.queryResult = [{ _id: 'abc123', title: 'Write tests', createdAt: now }]

      const result = useZodQuery(fakeRef('tasks:list'))

      expect(result).toBeDefined()
      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('Write tests')
      expect(result[0].createdAt).toBeInstanceOf(Date)
      expect(result[0].createdAt.getTime()).toBe(now)
    })

    it('passes through unchanged when function is not in the registry', () => {
      const raw = { foo: 'bar' }
      mocks.queryResult = raw

      const result = useZodQuery(fakeRef('unknown:fn'))
      expect(result).toEqual(raw)
    })

    it('passes through unchanged when registry entry has no returns schema', () => {
      const raw = { data: 42 }
      mocks.queryResult = raw

      const result = useZodQuery(fakeRef('plain:noCodec'))
      expect(result).toEqual(raw)
    })

    it('encodes args through the args schema (Date -> number)', () => {
      const dueDate = new Date('2026-06-15T00:00:00Z')
      mocks.queryResult = { _id: 'x', title: 'Test', createdAt: Date.now() }

      useZodQuery(fakeRef('tasks:create'), { title: 'Test', dueAt: dueDate })

      // Args passed to useQuery should be encoded: Date -> timestamp number
      expect(mocks.queryArgs).toBeDefined()
      expect(mocks.queryArgs.title).toBe('Test')
      expect(typeof mocks.queryArgs.dueAt).toBe('number')
      expect(mocks.queryArgs.dueAt).toBe(dueDate.getTime())
    })

    it('passes args through when function has no args schema', () => {
      const rawArgs = { raw: 'data' }
      mocks.queryResult = { data: 42 }

      useZodQuery(fakeRef('plain:noCodec'), rawArgs)

      expect(mocks.queryArgs).toEqual(rawArgs)
    })

    it('decodes a single object with zx.date() fields', () => {
      const ts = 1700000000000
      mocks.queryResult = { _id: 'x', title: 'Single', createdAt: ts }

      // Use a single-object returns schema for this test
      const singleRegistry = {
        'tasks:get': { returns: taskReturnsSchema }
      }
      const hooks = createZodvexHooks(singleRegistry)
      const result = hooks.useZodQuery(fakeRef('tasks:get'))

      expect(result.createdAt).toBeInstanceOf(Date)
      expect(result.createdAt.getTime()).toBe(ts)
    })

    it('default: warns and returns raw wire data on decode failure', () => {
      // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op spy
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mocks.queryResult = [{ _id: 'abc', title: 123, createdAt: Date.now() }]
      const result = useZodQuery(fakeRef('tasks:list'))
      expect(result).toBe(mocks.queryResult)
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('throw mode: throws ZodvexDecodeError on decode failure', () => {
      const throwHooks = createZodvexHooks(registry as any, { onDecodeError: 'throw' })
      mocks.queryResult = [{ _id: 'abc', title: 123, createdAt: Date.now() }]
      expect(() => throwHooks.useZodQuery(fakeRef('tasks:list'))).toThrow()
    })

    it('auto-skips query and logs debug when encodeArgs fails', () => {
      // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op spy
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
      mocks.queryResult = { _id: 'x', title: 'Test', createdAt: Date.now() }

      // Pass invalid args — dueAt should be a Date, passing a string triggers encode failure
      const result = useZodQuery(fakeRef('tasks:create'), {
        title: 'Test',
        dueAt: 'not-a-date'
      })

      // Should auto-skip: return undefined (loading state), not throw
      expect(result).toBeUndefined()
      expect(debugSpy).toHaveBeenCalled()
      const msg = debugSpy.mock.calls[0][0] as string
      expect(msg).toContain('tasks:create')
      expect(msg).toContain('auto-skipping')
      debugSpy.mockRestore()
    })
  })

  // ---- useZodMutation -----------------------------------------------------

  describe('useZodMutation', () => {
    it('encodes args through the args schema (Date -> number)', async () => {
      const dueDate = new Date('2026-06-15T00:00:00Z')
      let capturedArgs: any = null

      mocks.mutateImpl = (args: any) => {
        capturedArgs = args
        return { _id: 'new1', title: args.title, createdAt: Date.now() }
      }

      const mutate = useZodMutation(fakeRef('tasks:create'))
      await mutate({ title: 'New task', dueAt: dueDate })

      // Args should be encoded: Date -> timestamp number
      expect(capturedArgs).toBeDefined()
      expect(capturedArgs.title).toBe('New task')
      expect(typeof capturedArgs.dueAt).toBe('number')
      expect(capturedArgs.dueAt).toBe(dueDate.getTime())
    })

    it('decodes the mutation return value through the returns schema', async () => {
      const ts = 1700000000000
      mocks.mutateImpl = (_args: any) => {
        return { _id: 'new2', title: 'Created', createdAt: ts }
      }

      const mutate = useZodMutation(fakeRef('tasks:create'))
      const result = await mutate({ title: 'Created', dueAt: new Date(ts) })

      expect(result.createdAt).toBeInstanceOf(Date)
      expect(result.createdAt.getTime()).toBe(ts)
    })

    it('passes args through when function has no args schema', async () => {
      let capturedArgs: any = null
      mocks.mutateImpl = (args: any) => {
        capturedArgs = args
        return {}
      }

      const mutate = useZodMutation(fakeRef('plain:noCodec'))
      await mutate({ raw: 'data' })

      expect(capturedArgs).toEqual({ raw: 'data' })
    })

    it('passes return through when function has no returns schema', async () => {
      const raw = { result: 'unchanged' }
      mocks.mutateImpl = (_args: any) => raw

      const mutate = useZodMutation(fakeRef('plain:noCodec'))
      const result = await mutate({})

      expect(result).toEqual(raw)
    })

    it('strips undefined values from encoded args', async () => {
      // Create a schema with an optional field
      const optionalArgsSchema = z.object({
        title: z.string(),
        description: z.optional(z.string())
      })
      const optionalRegistry = {
        'notes:create': { args: optionalArgsSchema }
      }
      const hooks = createZodvexHooks(optionalRegistry)

      let capturedArgs: any = null
      mocks.mutateImpl = (args: any) => {
        capturedArgs = args
        return {}
      }

      const mutate = hooks.useZodMutation(fakeRef('notes:create'))
      // Pass data without the optional field — z.encode may produce explicit undefined
      await mutate({ title: 'Hello' })

      // After stripUndefined, the description key should not be present
      expect(capturedArgs).toBeDefined()
      expect(capturedArgs.title).toBe('Hello')
      expect('description' in capturedArgs).toBe(false)
    })
  })

  // ---- Type export --------------------------------------------------------

  describe('types', () => {
    it('exports ZodvexHooks type', async () => {
      const mod = await import('../src/react/hooks')
      // ZodvexHooks should be exported (it's a type, but the module should be importable)
      expect(typeof mod.createZodvexHooks).toBe('function')
    })
  })
})
