import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { createZodvexActionCtx } from '../src/actionCtx'
import { zx } from '../src/zx'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const functionNameSymbol = Symbol.for('functionName')

/** Create a fake FunctionReference with the well-known functionName symbol */
function fakeRef(path: string) {
  return { [functionNameSymbol]: path } as any
}

/** No-op async stub that satisfies the linter (no empty blocks) */
const noop = async () => undefined as any

// ---------------------------------------------------------------------------
// Registry with codec schemas
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
  'tasks:get': {
    args: taskArgsSchema,
    returns: taskReturnsSchema
  },
  'tasks:list': {
    returns: z.array(taskReturnsSchema)
  },
  'tasks:create': {
    args: taskArgsSchema,
    returns: taskReturnsSchema
  },
  'plain:noCodec': {
    // No schemas -- should passthrough
  },
  'partial:returnsOnly': {
    returns: taskReturnsSchema
  },
  'partial:argsOnly': {
    args: taskArgsSchema
  }
} as const

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createZodvexActionCtx', () => {
  // ---- runQuery - decoding results ----------------------------------------

  describe('runQuery', () => {
    it('decodes results via the returns schema (number -> Date)', async () => {
      const ts = 1700000000000
      const mockCtx = {
        runQuery: async (_ref: any, _args: any) => ({
          _id: 'abc123',
          title: 'Write tests',
          createdAt: ts
        }),
        runMutation: noop,
        runAction: noop,
        auth: { getUserIdentity: async () => null },
        scheduler: {},
        storage: {}
      }

      const wrappedCtx = createZodvexActionCtx(registry as any, mockCtx as any)
      const result: any = await wrappedCtx.runQuery(fakeRef('tasks:get'), {
        title: 'ignored',
        dueAt: new Date(ts)
      })

      expect(result._id).toBe('abc123')
      expect(result.title).toBe('Write tests')
      expect(result.createdAt).toBeInstanceOf(Date)
      expect(result.createdAt.getTime()).toBe(ts)
    })

    it('encodes args via the args schema (Date -> number)', async () => {
      const dueDate = new Date('2026-06-15T00:00:00Z')
      let capturedArgs: any = null

      const mockCtx = {
        runQuery: async (_ref: any, args: any) => {
          capturedArgs = args
          return { _id: 'x', title: 'T', createdAt: Date.now() }
        },
        runMutation: noop,
        runAction: noop,
        auth: { getUserIdentity: async () => null }
      }

      const wrappedCtx = createZodvexActionCtx(registry as any, mockCtx as any)
      await wrappedCtx.runQuery(fakeRef('tasks:get'), {
        title: 'New task',
        dueAt: dueDate
      })

      expect(capturedArgs).toBeDefined()
      expect(capturedArgs.title).toBe('New task')
      expect(typeof capturedArgs.dueAt).toBe('number')
      expect(capturedArgs.dueAt).toBe(dueDate.getTime())
    })

    it('decodes array results via the returns schema', async () => {
      const ts = 1700000000000
      const mockCtx = {
        runQuery: async () => [
          { _id: 'a', title: 'First', createdAt: ts },
          { _id: 'b', title: 'Second', createdAt: ts + 1000 }
        ],
        runMutation: noop,
        runAction: noop,
        auth: { getUserIdentity: async () => null }
      }

      const wrappedCtx = createZodvexActionCtx(registry as any, mockCtx as any)
      const result: any = await wrappedCtx.runQuery(fakeRef('tasks:list'))

      expect(result).toHaveLength(2)
      expect(result[0].createdAt).toBeInstanceOf(Date)
      expect(result[0].createdAt.getTime()).toBe(ts)
      expect(result[1].createdAt).toBeInstanceOf(Date)
      expect(result[1].createdAt.getTime()).toBe(ts + 1000)
    })

    it('passes through when function is not in the registry', async () => {
      const raw = { foo: 'bar', count: 42 }
      const mockCtx = {
        runQuery: async (_ref: any, _args: any) => raw,
        runMutation: noop,
        runAction: noop,
        auth: { getUserIdentity: async () => null }
      }

      const wrappedCtx = createZodvexActionCtx(registry as any, mockCtx as any)
      const result = await wrappedCtx.runQuery(fakeRef('unknown:fn'), { x: 1 })

      expect(result).toEqual(raw)
    })

    it('passes through when registry entry has no returns schema', async () => {
      const raw = { data: 42 }
      const mockCtx = {
        runQuery: async () => raw,
        runMutation: noop,
        runAction: noop,
        auth: { getUserIdentity: async () => null }
      }

      const wrappedCtx = createZodvexActionCtx(registry as any, mockCtx as any)
      const result = await wrappedCtx.runQuery(fakeRef('partial:argsOnly'))

      expect(result).toEqual(raw)
    })

    it('passes args through when registry entry has no args schema', async () => {
      let capturedArgs: any = null
      const mockCtx = {
        runQuery: async (_ref: any, args: any) => {
          capturedArgs = args
          return { _id: 'x', title: 'T', createdAt: Date.now() }
        },
        runMutation: noop,
        runAction: noop,
        auth: { getUserIdentity: async () => null }
      }

      const rawArgs = { someField: 'raw' }
      const wrappedCtx = createZodvexActionCtx(registry as any, mockCtx as any)
      await wrappedCtx.runQuery(fakeRef('partial:returnsOnly'), rawArgs)

      expect(capturedArgs).toEqual(rawArgs)
    })
  })

  // ---- runMutation - decoding results + encoding args ---------------------

  describe('runMutation', () => {
    it('decodes results via the returns schema (number -> Date)', async () => {
      const ts = 1700000000000
      const mockCtx = {
        runQuery: noop,
        runMutation: async (_ref: any, _args: any) => ({
          _id: 'new1',
          title: 'Created',
          createdAt: ts
        }),
        runAction: noop,
        auth: { getUserIdentity: async () => null }
      }

      const wrappedCtx = createZodvexActionCtx(registry as any, mockCtx as any)
      const result: any = await wrappedCtx.runMutation(fakeRef('tasks:create'), {
        title: 'Created',
        dueAt: new Date(ts)
      })

      expect(result._id).toBe('new1')
      expect(result.createdAt).toBeInstanceOf(Date)
      expect(result.createdAt.getTime()).toBe(ts)
    })

    it('encodes args via the args schema (Date -> number)', async () => {
      const dueDate = new Date('2026-06-15T00:00:00Z')
      let capturedArgs: any = null

      const mockCtx = {
        runQuery: noop,
        runMutation: async (_ref: any, args: any) => {
          capturedArgs = args
          return { _id: 'x', title: 'T', createdAt: Date.now() }
        },
        runAction: noop,
        auth: { getUserIdentity: async () => null }
      }

      const wrappedCtx = createZodvexActionCtx(registry as any, mockCtx as any)
      await wrappedCtx.runMutation(fakeRef('tasks:create'), {
        title: 'New task',
        dueAt: dueDate
      })

      expect(capturedArgs).toBeDefined()
      expect(capturedArgs.title).toBe('New task')
      expect(typeof capturedArgs.dueAt).toBe('number')
      expect(capturedArgs.dueAt).toBe(dueDate.getTime())
    })

    it('passes through when function is not in the registry', async () => {
      const raw = { result: 'unchanged' }
      const mockCtx = {
        runQuery: noop,
        runMutation: async (_ref: any, _args: any) => raw,
        runAction: noop,
        auth: { getUserIdentity: async () => null }
      }

      const wrappedCtx = createZodvexActionCtx(registry as any, mockCtx as any)
      const result = await wrappedCtx.runMutation(fakeRef('unknown:fn'), { x: 1 })

      expect(result).toEqual(raw)
    })

    it('passes through when registry entry has no returns/args schema', async () => {
      let capturedArgs: any = null
      const raw = { data: 'plain' }
      const mockCtx = {
        runQuery: noop,
        runMutation: async (_ref: any, args: any) => {
          capturedArgs = args
          return raw
        },
        runAction: noop,
        auth: { getUserIdentity: async () => null }
      }

      const wrappedCtx = createZodvexActionCtx(registry as any, mockCtx as any)
      const result = await wrappedCtx.runMutation(fakeRef('plain:noCodec'), { raw: 'data' })

      expect(capturedArgs).toEqual({ raw: 'data' })
      expect(result).toEqual(raw)
    })
  })

  // ---- stripUndefined on encoded args ------------------------------------

  describe('stripUndefined', () => {
    it('strips undefined values from encoded args', async () => {
      const optionalArgsSchema = z.object({
        title: z.string(),
        description: z.string().optional()
      })

      const optionalRegistry = {
        'notes:create': { args: optionalArgsSchema }
      }

      let capturedArgs: any = null
      const mockCtx = {
        runQuery: async (_ref: any, args: any) => {
          capturedArgs = args
          return undefined
        },
        runMutation: noop,
        runAction: noop,
        auth: { getUserIdentity: async () => null }
      }

      const wrappedCtx = createZodvexActionCtx(optionalRegistry, mockCtx as any)
      // Pass data without the optional field -- z.encode may produce explicit undefined
      await wrappedCtx.runQuery(fakeRef('notes:create'), { title: 'Hello' })

      expect(capturedArgs).toBeDefined()
      expect(capturedArgs.title).toBe('Hello')
      // After stripUndefined, the description key should not be present
      expect('description' in capturedArgs).toBe(false)
    })
  })

  // ---- Preserves other ctx properties ------------------------------------

  describe('ctx preservation', () => {
    it('preserves other ctx properties (runAction, auth, scheduler, storage)', () => {
      const authObj = { getUserIdentity: async () => ({ subject: 'user123' }) }
      const schedulerObj = { runAfter: noop }
      const storageObj = { getUrl: async () => 'https://example.com/file' }
      const runActionFn = async () => 'action result'

      const mockCtx = {
        runQuery: noop,
        runMutation: noop,
        runAction: runActionFn,
        auth: authObj,
        scheduler: schedulerObj,
        storage: storageObj
      }

      const wrappedCtx = createZodvexActionCtx(registry as any, mockCtx as any)

      // runAction should be the original (not wrapped)
      expect(wrappedCtx.runAction).toBe(runActionFn)
      // auth, scheduler, storage should be preserved
      expect((wrappedCtx as any).auth).toBe(authObj)
      expect((wrappedCtx as any).scheduler).toBe(schedulerObj)
      expect((wrappedCtx as any).storage).toBe(storageObj)
    })

    it('runQuery and runMutation are replaced (not the originals)', () => {
      const originalRunQuery = async () => 'original-query'
      const originalRunMutation = async () => 'original-mutation'

      const mockCtx = {
        runQuery: originalRunQuery,
        runMutation: originalRunMutation,
        runAction: noop,
        auth: { getUserIdentity: async () => null }
      }

      const wrappedCtx = createZodvexActionCtx(registry as any, mockCtx as any)

      expect(wrappedCtx.runQuery).not.toBe(originalRunQuery)
      expect(wrappedCtx.runMutation).not.toBe(originalRunMutation)
    })
  })
})
