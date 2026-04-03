import { describe, test, expect } from 'vitest'
import { z } from 'zod'
import { z as zm } from 'zod/mini'
import { getZ, setZodFactory } from '../src/zod-core'

describe('zod-factory', () => {
  test('setZodFactory(z) makes getZ() return full zod', () => {
    setZodFactory(z)
    const got = getZ()
    expect(typeof got.object).toBe('function')
    expect(typeof got.string).toBe('function')
    // Full zod schemas have many own properties (fluent API methods)
    const obj = got.object({ name: got.string() })
    expect(Object.getOwnPropertyNames(obj).length).toBeGreaterThan(30)
  })

  test('setZodFactory(zm) switches to zod/mini', () => {
    setZodFactory(zm as any)
    const got = getZ()
    expect(typeof got.object).toBe('function')
    expect(typeof got.string).toBe('function')
    // Mini schemas have fewer own properties (no fluent methods)
    const obj = got.object({ name: got.string() })
    expect(Object.getOwnPropertyNames(obj).length).toBeLessThan(30)
    // Restore full zod for other tests
    setZodFactory(z)
  })
})
