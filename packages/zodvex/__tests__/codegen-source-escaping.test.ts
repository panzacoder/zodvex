import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zodToSource } from '../src/public/codegen/zodToSource'

describe('generated schema source escaping', () => {
  it.each(['a"b', "a'b", 'a\\b', 'a\nb', '\u2028'])('round trips literal %j', value => {
    const original = z.literal(value)
    const generated = new Function('z', `return ${zodToSource(original)}`)(z)
    expect(generated.parse(value)).toBe(value)
    expect(generated.safeParse(`${value}!`).success).toBe(false)
  })

  it('round trips enum values containing quotes, slashes, and newlines', () => {
    const values = ['a"b', 'a\\b', 'a\nb'] as const
    const original = z.enum(values)
    const generated = new Function('z', `return ${zodToSource(original)}`)(z)
    for (const value of values) expect(generated.parse(value)).toBe(value)
    expect(generated.safeParse('unknown').success).toBe(false)
  })

  it('preserves non-identifier object keys and nested values', () => {
    const original = z.object({
      'display-name': z.string(),
      'a"b': z.object({ 'line\nbreak': z.literal('a"b') }),
      '': z.boolean()
    })
    const generated = new Function('z', `return ${zodToSource(original)}`)(z)
    const input = { 'display-name': 'Ada', 'a"b': { 'line\nbreak': 'a"b' }, '': true }
    expect(generated.parse(input)).toEqual(original.parse(input))
    expect(generated.safeParse({ ...input, 'display-name': 1 }).success).toBe(false)
  })

  it('emits __proto__ as an own shape property rather than an object prototype', () => {
    const original = z.object({ ['__proto__']: z.string() })
    const generated = new Function('z', `return ${zodToSource(original)}`)(z)
    expect(Object.hasOwn(generated._zod.def.shape, '__proto__')).toBe(true)
  })
})
