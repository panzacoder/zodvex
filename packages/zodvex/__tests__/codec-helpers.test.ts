import { describe, expect, it, mock } from 'bun:test'
import { z } from 'zod'
import { zx } from '../src/zx'

// ---------------------------------------------------------------------------
// Mock convex/server — we need getFunctionName to work
// ---------------------------------------------------------------------------

mock.module('convex/server', () => ({
  getFunctionName: (ref: any) => ref._testPath
}))

// Import AFTER mocks are set up (bun:test hoists mock.module)
const { createBoundaryHelpers } = await import('../src/boundaryHelpers')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fake FunctionReference with a _testPath property */
function fakeRef(path: string) {
  return { _testPath: path } as any
}

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
  'plain:noCodec': {
    // No schemas — should passthrough
  }
} as const

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createBoundaryHelpers', () => {
  const { encodeArgs, decodeResult } = createBoundaryHelpers(registry as any)

  // ---- encodeArgs ----------------------------------------------------------

  describe('encodeArgs', () => {
    it('encodes Date -> number via codec', () => {
      const dueDate = new Date('2026-06-15T00:00:00Z')
      const encoded = encodeArgs(fakeRef('tasks:get'), { title: 'Test', dueAt: dueDate })

      expect(encoded.title).toBe('Test')
      expect(typeof encoded.dueAt).toBe('number')
      expect(encoded.dueAt).toBe(dueDate.getTime())
    })

    it('strips undefined values after encoding', () => {
      const optionalArgsSchema = z.object({
        title: z.string(),
        description: z.string().optional()
      })
      const optionalRegistry = {
        'notes:create': { args: optionalArgsSchema }
      }
      const helpers = createBoundaryHelpers(optionalRegistry)

      // Pass data without the optional field — z.encode may produce explicit undefined
      const encoded = helpers.encodeArgs(fakeRef('notes:create'), { title: 'Hello' })

      expect(encoded.title).toBe('Hello')
      expect('description' in encoded).toBe(false)
    })

    it('passes through when no args schema in registry', () => {
      const raw = { raw: 'passthrough' }
      const result = encodeArgs(fakeRef('plain:noCodec'), raw)
      expect(result).toEqual(raw)
    })

    it('passes through when function is not in the registry', () => {
      const raw = { some: 'data' }
      const result = encodeArgs(fakeRef('unknown:fn'), raw)
      expect(result).toEqual(raw)
    })

    it('passes through when args is null', () => {
      const result = encodeArgs(fakeRef('tasks:get'), null)
      expect(result).toBeNull()
    })
  })

  // ---- decodeResult --------------------------------------------------------

  describe('decodeResult', () => {
    it('decodes number -> Date via codec', () => {
      const ts = 1700000000000
      const wireResult = { _id: 'abc123', title: 'Write tests', createdAt: ts }
      const decoded = decodeResult(fakeRef('tasks:get'), wireResult)

      expect(decoded._id).toBe('abc123')
      expect(decoded.title).toBe('Write tests')
      expect(decoded.createdAt).toBeInstanceOf(Date)
      expect(decoded.createdAt.getTime()).toBe(ts)
    })

    it('decodes array results via the returns schema', () => {
      const ts = 1700000000000
      const wireResult = [
        { _id: 'a', title: 'First', createdAt: ts },
        { _id: 'b', title: 'Second', createdAt: ts + 1000 }
      ]
      const decoded = decodeResult(fakeRef('tasks:list'), wireResult)

      expect(decoded).toHaveLength(2)
      expect(decoded[0].createdAt).toBeInstanceOf(Date)
      expect(decoded[0].createdAt.getTime()).toBe(ts)
      expect(decoded[1].createdAt).toBeInstanceOf(Date)
      expect(decoded[1].createdAt.getTime()).toBe(ts + 1000)
    })

    it('passes through when no returns schema in registry', () => {
      const raw = { data: 42 }
      const result = decodeResult(fakeRef('plain:noCodec'), raw)
      expect(result).toEqual(raw)
    })

    it('passes through when function is not in the registry', () => {
      const raw = { foo: 'bar' }
      const result = decodeResult(fakeRef('unknown:fn'), raw)
      expect(result).toEqual(raw)
    })
  })
})
