import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as mini from 'zod/mini'
import { initZodvex } from '../src/internal/functions/init'

// Capture the definition handed to Convex so the test can invoke its wire handler.
const capture = (definition: any) => definition
const server = {
  query: capture,
  mutation: capture,
  action: capture,
  internalQuery: capture,
  internalMutation: capture,
  internalAction: capture
}

describe.each([
  'zq',
  'zm',
  'za',
  'ziq',
  'zim',
  'zia'
] as const)('%s customization pipeline', name => {
  it.each([false, true])('decodes, overwrites and encodes (mini=%s)', useMini => {
    const at = z.codec(z.string(), z.date(), {
      decode: value => new Date(value),
      encode: value => value.toISOString()
    })
    const count = useMini ? mini.number() : z.number()
    const args = useMini ? mini.object({ count, at }) : z.object({ count, at })
    const builder = initZodvex({ __zodTableMap: {} }, server, { wrapDb: false })[name]
    const events: unknown[] = []
    const customized = builder.withContext({
      args: { token: at },
      input: (ctx, input) => {
        events.push(['input', input.token, ctx])
        return {
          ctx: { identity: 'custom' },
          args: { count: 'replacement' },
          onSuccess: ({ ctx, args, result }) => {
            events.push(['success', ctx, args, result])
          }
        }
      }
    })
    const definition = customized({
      args,
      returns: at,
      handler: (ctx, value) => {
        events.push(['handler', ctx, value])
        return value.at
      }
    }) as any
    const original = { identity: 'original' }
    const date = new Date('2026-01-01T00:00:00.000Z')
    return expect(
      definition.handler(original, { count: 4, at: date.toISOString(), token: date.toISOString() })
    )
      .resolves.toBe(date.toISOString())
      .then(() => {
        expect(events).toEqual([
          ['input', date, original],
          ['handler', { identity: 'custom' }, { count: 'replacement', at: date }],
          ['success', original, { count: 4, at: date }, date]
        ])
      })
  })
})

describe('handler shorthand compatibility', () => {
  it('forwards empty options for a plain handler', async () => {
    const { customFnBuilder } = await import('../src/internal/functions/customFunctions')
    const options: unknown[] = []
    const builder = customFnBuilder(capture, {
      args: {},
      input: (_ctx, _args, extra) => {
        options.push(extra)
        return { ctx: {}, args: {} }
      }
    })
    const definition = builder(() => 1)
    expect(await definition.handler({}, {})).toBe(1)
    expect(options).toEqual([{}])
  })

  it('honors validators and custom options attached to the function', async () => {
    const { customFnBuilder } = await import('../src/internal/functions/customFunctions')
    const options: unknown[] = []
    const builder = customFnBuilder(capture, {
      args: {},
      input: (_ctx, _args, extra) => {
        options.push(extra)
        return { ctx: {}, args: {} }
      }
    })
    const at = z.codec(z.string(), z.date(), {
      decode: value => new Date(value),
      encode: value => value.toISOString()
    })
    const definition = builder(
      Object.assign((_ctx: unknown, args: { at: Date }) => args.at, {
        args: z.object({ at }),
        returns: at,
        skipConvexValidation: true,
        label: 'attached'
      })
    )
    const wire = '2026-01-01T00:00:00.000Z'
    expect(await definition.handler({}, { at: wire })).toBe(wire)
    expect(options).toEqual([{ skipConvexValidation: true, label: 'attached' }])
  })
})
