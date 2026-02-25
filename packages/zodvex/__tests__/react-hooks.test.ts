import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { z } from 'zod'
import { stripUndefined } from '../src/utils'
import { zx } from '../src/zx'

// ---------------------------------------------------------------------------
// Mock convex/react — we simulate useQuery and useMutation behaviour
// without requiring React or a real ConvexProvider.
// ---------------------------------------------------------------------------

// Shared state that tests can configure before each call
let mockQueryResult: any = undefined
let mockMutateImpl: ((args: any) => any) | undefined = undefined

mock.module('convex/react', () => ({
  useQuery: (_ref: any, ..._args: any[]) => mockQueryResult,
  useMutation: (_ref: any) => {
    // Return a function that simulates calling the server mutation
    return async (args: any) => {
      if (mockMutateImpl) return mockMutateImpl(args)
      return args
    }
  }
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
const { createZodvexHooks } = await import('../src/react/hooks')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fake FunctionReference with a _testPath property */
function fakeRef(path: string) {
  return { _testPath: path } as any
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
    mockQueryResult = undefined
    mockMutateImpl = undefined
  })

  // ---- useZodQuery --------------------------------------------------------

  describe('useZodQuery', () => {
    it('returns undefined when the query is still loading', () => {
      mockQueryResult = undefined
      const result = useZodQuery(fakeRef('tasks:list'))
      expect(result).toBeUndefined()
    })

    it('decodes wire data through the returns schema (number -> Date)', () => {
      const now = Date.now()
      mockQueryResult = [{ _id: 'abc123', title: 'Write tests', createdAt: now }]

      const result = useZodQuery(fakeRef('tasks:list'))

      expect(result).toBeDefined()
      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('Write tests')
      expect(result[0].createdAt).toBeInstanceOf(Date)
      expect(result[0].createdAt.getTime()).toBe(now)
    })

    it('passes through unchanged when function is not in the registry', () => {
      const raw = { foo: 'bar' }
      mockQueryResult = raw

      const result = useZodQuery(fakeRef('unknown:fn'))
      expect(result).toEqual(raw)
    })

    it('passes through unchanged when registry entry has no returns schema', () => {
      const raw = { data: 42 }
      mockQueryResult = raw

      const result = useZodQuery(fakeRef('plain:noCodec'))
      expect(result).toEqual(raw)
    })

    it('decodes a single object with zx.date() fields', () => {
      const ts = 1700000000000
      mockQueryResult = { _id: 'x', title: 'Single', createdAt: ts }

      // Use a single-object returns schema for this test
      const singleRegistry = {
        'tasks:get': { returns: taskReturnsSchema }
      }
      const hooks = createZodvexHooks(singleRegistry)
      const result = hooks.useZodQuery(fakeRef('tasks:get'))

      expect(result.createdAt).toBeInstanceOf(Date)
      expect(result.createdAt.getTime()).toBe(ts)
    })
  })

  // ---- useZodMutation -----------------------------------------------------

  describe('useZodMutation', () => {
    it('encodes args through the args schema (Date -> number)', async () => {
      const dueDate = new Date('2026-06-15T00:00:00Z')
      let capturedArgs: any = null

      mockMutateImpl = (args: any) => {
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
      mockMutateImpl = (_args: any) => {
        return { _id: 'new2', title: 'Created', createdAt: ts }
      }

      const mutate = useZodMutation(fakeRef('tasks:create'))
      const result = await mutate({ title: 'Created', dueAt: new Date(ts) })

      expect(result.createdAt).toBeInstanceOf(Date)
      expect(result.createdAt.getTime()).toBe(ts)
    })

    it('passes args through when function has no args schema', async () => {
      let capturedArgs: any = null
      mockMutateImpl = (args: any) => {
        capturedArgs = args
        return {}
      }

      const mutate = useZodMutation(fakeRef('plain:noCodec'))
      await mutate({ raw: 'data' })

      expect(capturedArgs).toEqual({ raw: 'data' })
    })

    it('passes return through when function has no returns schema', async () => {
      const raw = { result: 'unchanged' }
      mockMutateImpl = (_args: any) => raw

      const mutate = useZodMutation(fakeRef('plain:noCodec'))
      const result = await mutate({})

      expect(result).toEqual(raw)
    })

    it('strips undefined values from encoded args', async () => {
      // Create a schema with an optional field
      const optionalArgsSchema = z.object({
        title: z.string(),
        description: z.string().optional()
      })
      const optionalRegistry = {
        'notes:create': { args: optionalArgsSchema }
      }
      const hooks = createZodvexHooks(optionalRegistry)

      let capturedArgs: any = null
      mockMutateImpl = (args: any) => {
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
      expect(mod.createZodvexHooks).toBeFunction()
    })
  })
})
