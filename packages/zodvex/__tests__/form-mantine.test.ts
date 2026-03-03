import { describe, expect, it, mock } from 'bun:test'
import { z } from 'zod'
import { zx } from '../src/zx'

// Mock convex/server — needed for getFunctionName in resolver
mock.module('convex/server', () => ({
  getFunctionName: (ref: any) => ref._testPath
}))

// Import AFTER mocks are set up
const { mantineResolver } = await import('../src/form/mantine')

/** Create a fake FunctionReference with a _testPath property */
function fakeRef(path: string) {
  return { _testPath: path } as any
}

describe('mantineResolver (mantine)', () => {
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
    const validate = mantineResolver(registry, fakeRef('users:create'))
    const errors = validate({ name: 'Alice', email: 'alice@example.com' })

    expect(errors).toEqual({})
  })

  it('returns field-level errors for invalid input', () => {
    const validate = mantineResolver(registry, fakeRef('users:create'))
    const errors = validate({ name: '', email: 'not-an-email' })

    expect(errors.name).toBeDefined()
    expect(errors.email).toBeDefined()
  })

  it('maps errors to correct field paths', () => {
    const validate = mantineResolver(registry, fakeRef('users:create'))
    const errors = validate({ name: '', email: 'bad' })

    expect(errors.name).toBe('Name is required')
    expect(errors.email).toBe('Invalid email')
  })

  it('does not error on omitted optional fields', () => {
    const validate = mantineResolver(registry, fakeRef('users:create'))
    const errors = validate({ name: 'Alice', email: 'alice@example.com' })

    expect(errors.age).toBeUndefined()
  })

  it('throws if function not found in registry', () => {
    expect(() => {
      mantineResolver(registry, fakeRef('nonexistent:fn'))
    }).toThrow('No args schema found')
  })

  it('works with different registry entries', () => {
    const validate = mantineResolver(registry, fakeRef('tasks:create'))
    const errors = validate({ title: '' })

    expect(errors.title).toBe('Title is required')
  })

  describe('codec field handling', () => {
    const registryWithCodec = {
      'items:create': {
        args: z.object({
          name: z.string().min(1, 'Name required'),
          secret: z.codec(z.object({ v: z.string() }), z.custom<{ expose: () => string }>(), {
            decode: wire => ({ expose: () => wire.v }),
            encode: runtime => ({ v: runtime.expose() })
          })
        })
      }
    }

    it('skips codec fields (validated server-side)', () => {
      const validate = mantineResolver(registryWithCodec, fakeRef('items:create'))

      // Broken clone (structuredClone strips methods) should NOT cause errors
      const errors = validate({ name: 'ok', secret: { _v: 'val' } })
      expect(errors).toEqual({})
    })

    it('still reports non-codec errors when codec fields are present', () => {
      const validate = mantineResolver(registryWithCodec, fakeRef('items:create'))

      // Invalid name + broken codec
      const errors = validate({ name: '', secret: { _v: 'val' } })
      expect(errors.name).toBe('Name required')
      expect(errors.secret).toBeUndefined()
    })

    it('skips optional codec fields too', () => {
      const registryOptionalCodec = {
        'items:update': {
          args: z.object({
            name: z.string().min(1),
            secret: z
              .codec(z.object({ v: z.string() }), z.custom<{ expose: () => string }>(), {
                decode: wire => ({ expose: () => wire.v }),
                encode: runtime => ({ v: runtime.expose() })
              })
              .optional()
          })
        }
      }
      const validate = mantineResolver(registryOptionalCodec, fakeRef('items:update'))

      const errors = validate({ name: 'ok' })
      expect(errors).toEqual({})
    })
  })
})
