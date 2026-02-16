import { describe, expect, it } from 'bun:test'
import { composeHooks, createDatabaseHooks } from '../../src/db/hooks'

describe('createDatabaseHooks', () => {
  it('returns the hook config as-is (type-level factory)', () => {
    const hooks = createDatabaseHooks<{ user: string }>({
      decode: {
        before: {
          one: async (ctx, doc) => {
            return doc
          }
        }
      }
    })
    expect(hooks.decode?.before?.one).toBeDefined()
  })

  it('supports encode hooks', () => {
    const hooks = createDatabaseHooks<{ user: string }>({
      encode: {
        before: async (ctx, doc) => doc,
        after: async (ctx, doc) => doc
      }
    })
    expect(hooks.encode?.before).toBeDefined()
    expect(hooks.encode?.after).toBeDefined()
  })
})

describe('composeHooks', () => {
  it('composes decode.before.one hooks in order', async () => {
    const log: string[] = []

    const hookA = createDatabaseHooks<Record<string, unknown>>({
      decode: {
        before: {
          one: async (_ctx, doc) => {
            log.push('A')
            return { ...doc, a: true }
          }
        }
      }
    })

    const hookB = createDatabaseHooks<Record<string, unknown>>({
      decode: {
        before: {
          one: async (_ctx, doc) => {
            log.push('B')
            return { ...doc, b: true }
          }
        }
      }
    })

    const composed = composeHooks([hookA, hookB])
    const result = await composed.decode?.before?.one?.({} as any, { original: true } as any)

    expect(log).toEqual(['A', 'B'])
    expect(result).toEqual({ original: true, a: true, b: true })
  })

  it('short-circuits decode.before.one when a hook returns null', async () => {
    const log: string[] = []

    const hookA = createDatabaseHooks<Record<string, unknown>>({
      decode: {
        before: {
          one: async () => {
            log.push('A')
            return null
          }
        }
      }
    })

    const hookB = createDatabaseHooks<Record<string, unknown>>({
      decode: {
        before: {
          one: async (_ctx, doc) => {
            log.push('B')
            return doc
          }
        }
      }
    })

    const composed = composeHooks([hookA, hookB])
    const result = await composed.decode?.before?.one?.({} as any, { data: true } as any)

    expect(log).toEqual(['A'])
    expect(result).toBeNull()
  })

  it('composes decode.after.one hooks in order', async () => {
    const log: string[] = []

    const hookA = createDatabaseHooks<Record<string, unknown>>({
      decode: {
        after: {
          one: async (_ctx, doc) => {
            log.push('afterA')
            return { ...doc, afterA: true }
          }
        }
      }
    })

    const hookB = createDatabaseHooks<Record<string, unknown>>({
      decode: {
        after: {
          one: async (_ctx, doc) => {
            log.push('afterB')
            return { ...doc, afterB: true }
          }
        }
      }
    })

    const composed = composeHooks([hookA, hookB])
    const result = await composed.decode?.after?.one?.({} as any, { data: true } as any)

    expect(log).toEqual(['afterA', 'afterB'])
    expect(result).toEqual({ data: true, afterA: true, afterB: true })
  })

  it('composes encode.before hooks in order', async () => {
    const log: string[] = []

    const hookA = createDatabaseHooks<Record<string, unknown>>({
      encode: {
        before: async (_ctx, doc) => {
          log.push('A')
          return { ...doc, a: true }
        }
      }
    })

    const hookB = createDatabaseHooks<Record<string, unknown>>({
      encode: {
        before: async (_ctx, doc) => {
          log.push('B')
          return { ...doc, b: true }
        }
      }
    })

    const composed = composeHooks([hookA, hookB])
    const result = await composed.encode?.before?.({} as any, { original: true } as any)

    expect(log).toEqual(['A', 'B'])
    expect(result).toEqual({ original: true, a: true, b: true })
  })

  it('composes encode.after hooks in order', async () => {
    const log: string[] = []

    const hookA = createDatabaseHooks<Record<string, unknown>>({
      encode: {
        after: async (_ctx, doc) => {
          log.push('afterA')
          return { ...doc, afterA: true }
        }
      }
    })

    const hookB = createDatabaseHooks<Record<string, unknown>>({
      encode: {
        after: async (_ctx, doc) => {
          log.push('afterB')
          return { ...doc, afterB: true }
        }
      }
    })

    const composed = composeHooks([hookA, hookB])
    const result = await composed.encode?.after?.({} as any, { original: true } as any)

    expect(log).toEqual(['afterA', 'afterB'])
    expect(result).toEqual({ original: true, afterA: true, afterB: true })
  })

  it('returns empty hooks when composing empty array', () => {
    const composed = composeHooks([])
    expect(composed).toEqual({})
  })

  it('returns single hooks as-is when array has one element', () => {
    const hooks = createDatabaseHooks<Record<string, unknown>>({
      decode: {
        after: {
          one: async (_ctx, doc) => doc
        }
      }
    })

    const composed = composeHooks([hooks])
    expect(composed.decode?.after?.one).toBe(hooks.decode?.after?.one)
  })

  it('encode.before short-circuits on null', async () => {
    const log: string[] = []

    const hookA = createDatabaseHooks<Record<string, unknown>>({
      encode: {
        before: async () => {
          log.push('A')
          return null
        }
      }
    })

    const hookB = createDatabaseHooks<Record<string, unknown>>({
      encode: {
        before: async (_ctx, doc) => {
          log.push('B')
          return doc
        }
      }
    })

    const composed = composeHooks([hookA, hookB])
    const result = await composed.encode?.before?.({} as any, { data: true } as any)

    expect(log).toEqual(['A'])
    expect(result).toBeNull()
  })
})
