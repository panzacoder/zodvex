import { describe, expect, it, mock } from 'bun:test'
import { z } from 'zod'
import { zx } from '../src/zx'

// Mock convex/server — needed for getFunctionName in resolver
mock.module('convex/server', () => ({
  getFunctionName: (ref: any) => ref._testPath
}))

// Import AFTER mocks are set up
const { zodvexResolver } = await import('../src/form/mantine')

/** Create a fake FunctionReference with a _testPath property */
function fakeRef(path: string) {
  return { _testPath: path } as any
}

describe('zodvexResolver (mantine)', () => {
  const registry = {
    'users:create': {
      args: z.object({
        name: z.string().min(1, 'Name is required'),
        email: z.string().email('Invalid email'),
        age: z.number().min(0).optional()
      })
    },
    'tasks:create': {
      args: z.object({
        title: z.string().min(1, 'Title is required'),
        estimate: zx.date().optional()
      })
    }
  }

  it('returns no errors for valid input', () => {
    const validate = zodvexResolver(registry, fakeRef('users:create'))
    const errors = validate({ name: 'Alice', email: 'alice@example.com' })

    expect(errors).toEqual({})
  })

  it('returns field-level errors for invalid input', () => {
    const validate = zodvexResolver(registry, fakeRef('users:create'))
    const errors = validate({ name: '', email: 'not-an-email' })

    expect(errors.name).toBeDefined()
    expect(errors.email).toBeDefined()
  })

  it('maps errors to correct field paths', () => {
    const validate = zodvexResolver(registry, fakeRef('users:create'))
    const errors = validate({ name: '', email: 'bad' })

    expect(errors.name).toBe('Name is required')
    expect(errors.email).toBe('Invalid email')
  })

  it('does not error on omitted optional fields', () => {
    const validate = zodvexResolver(registry, fakeRef('users:create'))
    const errors = validate({ name: 'Alice', email: 'alice@example.com' })

    expect(errors.age).toBeUndefined()
  })

  it('throws if function not found in registry', () => {
    expect(() => {
      zodvexResolver(registry, fakeRef('nonexistent:fn'))
    }).toThrow('No args schema found')
  })

  it('works with different registry entries', () => {
    const validate = zodvexResolver(registry, fakeRef('tasks:create'))
    const errors = validate({ title: '' })

    expect(errors.title).toBe('Title is required')
  })
})
