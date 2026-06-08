import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { readCodecBrand } from '../src/internal/meta'
import { zx } from '../src/internal/zx'
import type {
  CodecForGeneration,
  DiscoveredFunction,
  FunctionEmbeddedCodec
} from '../src/public/codegen/discover'
import { generateApiFile } from '../src/public/codegen/generate'

// Codec provenance brands — see docs/decisions/2026-06-08-codec-provenance-brands.md.
// A brand lets codegen match a function-embedded codec to its importable twin by
// *declared* identity instead of inferring it from structure (which collides for
// factory codecs whose wire shapes coincide).

const identity = { decode: (w: any) => w, encode: (r: any) => r }
const branded = (brand: string) => zx.codec(z.string(), z.string(), identity, { brand })
const unbranded = () => zx.codec(z.string(), z.string(), identity)

const fnUsing = (codec: ReturnType<typeof branded>) => {
  const functions: DiscoveredFunction[] = [
    {
      functionPath: 'm:run',
      exportName: 'run',
      sourceFile: 'fns/m.ts',
      zodArgs: z.object({ x: codec }),
      zodReturns: undefined
    }
  ]
  const functionCodecs: FunctionEmbeddedCodec[] = [
    {
      codec,
      functionExportName: 'run',
      functionSourceFile: 'fns/m.ts',
      schemaSource: 'zodArgs',
      accessPath: '.shape.x'
    }
  ]
  return { functions, functionCodecs }
}

describe('zx.codec provenance brand (runtime)', () => {
  it('attaches a readable, non-enumerable brand', () => {
    const c = branded('tagged:email')
    expect(readCodecBrand(c)).toBe('tagged:email')
    expect(Object.keys(c)).not.toContain('__zodvexCodecBrand')
    expect(JSON.stringify({ ...(c as object) })).not.toContain('__zodvexCodecBrand')
  })

  it('is undefined for unbranded codecs', () => {
    expect(readCodecBrand(unbranded())).toBeUndefined()
    expect(readCodecBrand(z.string())).toBeUndefined()
    expect(readCodecBrand(null)).toBeUndefined()
  })
})

describe('codegen: brand-aware codec matching', () => {
  it('brand match beats an ambiguous fingerprint sort', () => {
    // Both exports share a fingerprint (same shape + transforms). The WRONG one
    // ('tag') sorts first by source file, so a structure-only pick would choose
    // it. The brand must override that and reference the email twin.
    const tagExport = branded('tagged:tag') // sorts first
    const emailExport = branded('tagged:email') // sorts last
    const fnEmail = branded('tagged:email') // fresh instance, same brand as emailExport

    const codecs: CodecForGeneration[] = [
      { exportName: 'tagCodec', sourceFile: 'codecs/aaa.ts', schema: tagExport },
      { exportName: 'emailCodec', sourceFile: 'codecs/zzz.ts', schema: emailExport }
    ]
    const { functions, functionCodecs } = fnUsing(fnEmail)

    const result = generateApiFile(functions, [], codecs, [], functionCodecs)
    expect(result.js).toMatch(/emailCodec/)
    expect(result.js).not.toMatch(/tagCodec/)
    expect(result.js).not.toMatch(/transforms lost/)
  })

  it('namespaces across brands — a branded codec never matches a differently-branded twin', () => {
    // The only importable codec shares the function codec's fingerprint but a
    // different brand. Matching it would be a cross-factory error, so codegen
    // must refuse and hard-error rather than reference it.
    const sensitiveExport = branded('sensitive')
    const fnTagged = branded('tagged:email')

    const codecs: CodecForGeneration[] = [
      { exportName: 'sensCodec', sourceFile: 'codecs/a.ts', schema: sensitiveExport }
    ]
    const { functions, functionCodecs } = fnUsing(fnTagged)

    expect(() => generateApiFile(functions, [], codecs, [], functionCodecs)).toThrow(
      /no importable reference/i
    )
  })

  it('falls back to an unbranded fingerprint twin when no branded twin exists', () => {
    const rawExport = unbranded()
    const fnBranded = branded('tagged:email')

    const codecs: CodecForGeneration[] = [
      { exportName: 'rawCodec', sourceFile: 'codecs/a.ts', schema: rawExport }
    ]
    const { functions, functionCodecs } = fnUsing(fnBranded)

    const result = generateApiFile(functions, [], codecs, [], functionCodecs)
    expect(result.js).toMatch(/rawCodec/)
    expect(result.js).not.toMatch(/transforms lost/)
  })
})
