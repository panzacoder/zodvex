import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { initZodvex } from '../src/init'
import { defineZodSchema } from '../src/schema'
import { zodTable } from '../src/tables'
import { zx } from '../src/zx'

const Events = zodTable('events', {
  title: z.string(),
  startDate: zx.date()
})

const Users = zodTable('users', {
  name: z.string(),
  email: z.string()
})

const schema = defineZodSchema({ events: Events, users: Users })

// Mock server — returns the config object (mimics Convex builder passing through)
const server = {
  query: (config: any) => config,
  mutation: (config: any) => config,
  action: (config: any) => config,
  internalQuery: (config: any) => config,
  internalMutation: (config: any) => config,
  internalAction: (config: any) => config
}

describe('initZodvex', () => {
  it('returns all expected builders', () => {
    const result = initZodvex(schema, server as any)
    expect(result.zQuery).toBeDefined()
    expect(result.zMutation).toBeDefined()
    expect(result.zAction).toBeDefined()
    expect(result.zInternalQuery).toBeDefined()
    expect(result.zInternalMutation).toBeDefined()
    expect(result.zInternalAction).toBeDefined()
    expect(result.zCustomQuery).toBeDefined()
    expect(result.zCustomMutation).toBeDefined()
    expect(result.zCustomAction).toBeDefined()
  })

  it('zQuery produces a registered function when called with config', () => {
    const { zQuery } = initZodvex(schema, server as any)
    const fn = zQuery({
      args: { title: z.string() },
      handler: async (_ctx: any, { title }: any) => title
    })
    expect(fn).toBeDefined()
  })

  it('zQuery validates args with Zod (rejects invalid args)', async () => {
    const { zQuery } = initZodvex(schema, server as any)
    const fn = zQuery({
      args: { title: z.string().min(3) },
      handler: async (_ctx: any, { title }: any) => title
    })

    // Should throw validation error — "ab" is too short (min 3)
    await expect(fn.handler({}, { title: 'ab' })).rejects.toThrow()
  })

  it('zQuery encodes return values through Zod returns schema', async () => {
    const { zQuery } = initZodvex(schema, server as any)
    const fn = zQuery({
      args: {},
      returns: z.object({ when: zx.date() }),
      handler: async () => ({ when: new Date('2025-06-15T00:00:00Z') })
    })

    const result = await fn.handler({}, {})
    // Should be encoded to timestamp, not a Date
    expect(typeof result.when).toBe('number')
  })

  it('zMutation validates args with Zod', async () => {
    const { zMutation } = initZodvex(schema, server as any)
    const fn = zMutation({
      args: { email: z.string().email() },
      handler: async (_ctx: any, { email }: any) => email
    })

    // Should throw — "not-an-email" isn't valid
    await expect(fn.handler({}, { email: 'not-an-email' })).rejects.toThrow()
  })

  it('zAction validates args with Zod', async () => {
    const { zAction } = initZodvex(schema, server as any)
    const fn = zAction({
      args: { count: z.number().int().positive() },
      handler: async (_ctx: any, { count }: any) => count
    })

    // Should throw — -5 is not positive
    await expect(fn.handler({}, { count: -5 })).rejects.toThrow()
  })
})
