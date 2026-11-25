import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as mini from 'zod/mini'
import { applyCustomizationResult } from '../src/internal/functions/contracts'
import { composeContexts, defineContext, initZodvex } from '../src/public/server'

const passthrough = (definition: any) => definition
const builders = initZodvex(
  { __zodTableMap: {} },
  {
    query: passthrough,
    mutation: passthrough,
    action: passthrough,
    internalQuery: passthrough,
    internalMutation: passthrough,
    internalAction: passthrough
  } as any,
  { wrapDb: false }
)
const numberWire = z.codec(z.string(), z.number(), { decode: Number, encode: String })

function contexts(events: string[]) {
  const first = defineContext(builders.zm, {
    args: { factor: numberWire },
    validateDeclaration: (extra: { helpers?: readonly string[] }) => {
      events.push('register:first')
      if (extra.helpers?.some(name => name !== 'double')) throw new Error('unknown helper')
    },
    input: (_ctx, { factor }) => {
      events.push('input:first')
      return {
        ctx: { double: (n: number) => n * 2 },
        args: { factor },
        onSuccess: () => {
          events.push('success:first')
        }
      }
    }
  })
  const second = defineContext(first, {
    args: { label: z.string() },
    validateDeclaration: () => {
      events.push('register:second')
    },
    input: (ctx, args) => {
      events.push('input:second')
      expect(Object.keys(args)).toEqual(['label'])
      return {
        ctx: { label: args.label, doubled: ctx.double(3) },
        onSuccess: () => {
          events.push('success:second')
        }
      }
    }
  })
  return { first, second }
}

describe('context composition', () => {
  it('validates declarations in order and runs inputs then reverse success hooks with codecs', async () => {
    const events: string[] = []
    const { first, second } = contexts(events)
    const fn: any = builders.zm.withContext(composeContexts(first, second))({
      helpers: ['double'],
      args: { value: numberWire },
      returns: numberWire,
      handler: (ctx, { value, factor }) => {
        events.push(ctx.label)
        return ctx.double(value) * factor + ctx.doubled
      }
    })
    expect(events).toEqual(['register:first', 'register:second'])
    events.length = 0
    expect(
      await fn.handler({ auth: 'original' }, { factor: '3', value: '7', label: 'handler' })
    ).toBe('48')
    expect(events).toEqual([
      'input:first',
      'input:second',
      'handler',
      'success:second',
      'success:first'
    ])
  })

  it('rejects invalid and asynchronous declaration validators before registration', async () => {
    const { first } = contexts([])
    expect(() =>
      builders.zm.withContext(first)({ helpers: ['invalid'], handler: () => null })
    ).toThrow('unknown helper')
    const asynchronous = defineContext(builders.zm, {
      validateDeclaration: (async () => {
        throw new Error('async failure')
      }) as never
    })
    expect(() =>
      builders.zm.withContext(composeContexts(first, asynchronous))({ handler: () => null })
    ).toThrow('must be synchronous')
    await Promise.resolve()
  })

  it('supports replacement with and without an input, removing inherited keys', async () => {
    const { first } = contexts([])
    const replacement = defineContext(first, {
      contextMode: 'replace',
      input: () => ({ ctx: { safe: true } })
    })
    const fn: any = builders.zim.withContext(composeContexts(first, replacement))({
      args: {},
      returns: z.array(z.string()),
      handler: ctx => Reflect.ownKeys(ctx) as string[]
    })
    expect(await fn.handler({ auth: {}, db: {}, scheduler: {} }, { factor: '2' })).toEqual(['safe'])
    const empty: any = builders.zim.withContext({ contextMode: 'replace' })({
      args: {},
      returns: z.array(z.string()),
      handler: ctx => Object.keys(ctx)
    })
    expect(await empty.handler({ auth: {}, db: {} }, {})).toEqual([])
  })

  it('does not run success hooks after input or handler failure', async () => {
    for (const stage of ['input', 'handler']) {
      const events: string[] = []
      const { first } = contexts(events)
      const second = defineContext(first, {
        input: () => {
          if (stage === 'input') throw new Error(stage)
          return { ctx: {} }
        }
      })
      const fn: any = builders.zm.withContext(composeContexts(first, second))({
        args: {},
        handler: () => {
          throw new Error(stage)
        }
      })
      events.length = 0
      await expect(fn.handler({}, { factor: '2' })).rejects.toThrow(stage)
      expect(events).toEqual(['input:first'])
    }
  })

  it('stops success unwinding on failure and still validates returns after successful hooks', async () => {
    const events: string[] = []
    const { first } = contexts(events)
    const guard = defineContext(first, {
      input: () => ({
        ctx: {},
        onSuccess: () => {
          throw new Error('guard')
        }
      })
    })
    const guarded: any = builders.zm.withContext(composeContexts(first, guard))({
      args: {},
      handler: () => null
    })
    events.length = 0
    await expect(guarded.handler({}, { factor: '2' })).rejects.toThrow('guard')
    expect(events).toEqual(['input:first'])
    const invalid: any = builders.zm.withContext(composeContexts(first))({
      args: {},
      returns: z.number(),
      handler: () => 'invalid' as never
    })
    events.length = 0
    await expect(invalid.handler({}, { factor: '2' })).rejects.toThrow()
    expect(events).toEqual(['input:first', 'success:first'])
  })

  it('rejects duplicate declared and injected arguments', async () => {
    const { first } = contexts([])
    expect(() => composeContexts(first, first)).toThrow('Duplicate context argument: factor')
    const duplicate = defineContext(first, { input: () => ({ ctx: {}, args: { factor: 9 } }) })
    const fn: any = builders.zm.withContext(composeContexts(first, duplicate))({
      args: {},
      handler: () => null
    })
    await expect(fn.handler({}, { factor: '2' })).rejects.toThrow(
      'Duplicate injected context argument: factor'
    )
  })

  it('preserves optional context fallbacks and applies present replacements', async () => {
    for (const patch of [{}, { label: undefined }, { label: 'replacement' }]) {
      const first = defineContext(builders.zq, { input: () => ({ ctx: { label: 'original' } }) })
      const second = defineContext(first, {
        input: (): { ctx: { label?: string } } => ({ ctx: patch })
      })
      const fn: any = builders.zq.withContext(composeContexts(first, second))({
        args: {},
        handler: ctx => ctx.label
      })
      expect(await fn.handler({}, {})).toBe('label' in patch ? patch.label : 'original')
    }
  })

  it('supports mini schemas and function-only registrations', async () => {
    const first = defineContext(builders.zq, {
      args: { label: mini.string() },
      input: (_ctx, { label }) => ({ ctx: { label } })
    })
    const fn: any = builders.zq.withContext(composeContexts(first))({
      args: mini.object({ suffix: mini.string() }),
      returns: mini.string(),
      handler: (ctx, args) => ctx.label + args.suffix
    })
    expect(await fn.handler({}, { label: 'hello', suffix: '!' })).toBe('hello!')
    const shorthand: any = builders.zq.withContext(composeContexts(first))(ctx => ctx.label)
    expect(await shorthand.handler({}, { label: 'hello' })).toBe('hello')
  })

  it('leaves ordinary result merging unchanged', () => {
    expect(applyCustomizationResult({ kept: true }, {}, { ctx: { added: true } }).finalCtx).toEqual(
      { kept: true, added: true }
    )
  })
})
