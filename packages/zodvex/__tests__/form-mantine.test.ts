import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { mantineResolver } from '../src/form/mantine'
import { zx } from '../src/zx'

const functionNameSymbol = Symbol.for('functionName')

/** Create a fake FunctionReference with the well-known functionName symbol */
function fakeRef(path: string) {
  return { [functionNameSymbol]: path } as any
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
})
