import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { encode, parse } from '../src/internal/zod-core'
import { zx } from '../src/internal/zx'
import { extractCodec } from '../src/public/codegen/extractCodec'
import { generateApiFile } from '../src/public/codegen/generate'
import baseline from './fixtures/reference-resolution/baseline.json'
import { referenceResolutionInput } from './fixtures/reference-resolution/input'

describe('reference resolution through generation', () => {
  it.each([false, true])('preserves pre-refactor output byte-for-byte (mini=%s)', mini => {
    const input = referenceResolutionInput()
    const output = generateApiFile(
      input.functions,
      input.models,
      input.codecs,
      input.modelCodecs,
      input.functionCodecs,
      { mini }
    )

    // Captured from 2e65466, before the refactor, not from the implementation
    // under test. Covers identity, partial, brand, model extraction and passthrough.
    expect(output).toEqual(baseline[mini ? 1 : 0])
  })

  it('evaluates resolved codec references with transforms and memoized identity intact', () => {
    const input = referenceResolutionInput()
    const mini = typeof (z.string() as { optional?: unknown }).optional !== 'function'
    const { js } = generateApiFile(
      input.functions,
      input.models,
      input.codecs,
      input.modelCodecs,
      input.functionCodecs,
      { mini }
    )
    const evaluate = new Function(
      'z',
      'zx',
      'ItemModel',
      'caseCodec',
      'extractCodec',
      `${js.replace(/^import .*\n/gm, '').replace('export const zodvexRegistry', 'const zodvexRegistry')}\nreturn zodvexRegistry`
    )
    const registry = evaluate(
      z,
      zx,
      { schema: input.runtime.model.schemas },
      input.runtime.namedCodec,
      extractCodec
    )
    const entry = registry['items:convert']

    expect(encode(entry.args, { text: 'HELLO', amount: 10 })).toEqual({
      text: 'hello',
      amount: 5
    })
    expect(parse(entry.returns, 5)).toBe(10)
    expect(registry['items:convert']).toBe(entry)
    expect(Object.getOwnPropertyDescriptor(registry, 'items:convert')).toMatchObject({
      enumerable: true,
      get: expect.any(Function)
    })
    expect(js).not.toContain("from '../items.js'")
  })
})
