import { describe, test, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { z as zm } from 'zod/mini'

describe('zod-factory', () => {
  test('getZ() returns full zod by default', async () => {
    const { getZ } = await import('../src/zod-core')
    const z = getZ()
    expect(typeof z.object).toBe('function')
    expect(typeof z.string).toBe('function')
  })

  test('setZodFactory switches the z namespace', async () => {
    const { getZ, setZodFactory } = await import('../src/zod-core')
    setZodFactory(zm as any)
    const z = getZ()
    // Schemas from mini should have fewer own properties
    const obj = z.object({ name: z.string() })
    expect(Object.getOwnPropertyNames(obj).length).toBeLessThan(30)
  })
})
