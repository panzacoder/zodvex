import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zx } from '../src/internal/zx'
import type {
  DiscoveredFunction,
  DiscoveredModel,
  FunctionEmbeddedCodec,
  ModelEmbeddedCodec
} from '../src/public/codegen/discover'
import { type CodecForGeneration, generateApiFile } from '../src/public/codegen/generate'

// Regression coverage for hotpot MR 206: codegen output must be byte-identical
// regardless of the order in which models/functions/codecs were discovered.
// The fix sorts every input collection by stable keys before emission and
// replaces "last fingerprint candidate wins" with explicit ambiguity handling.

const buildModelDoc = (extraField?: string) =>
  z.object({
    _id: z.string(),
    name: z.string(),
    ...(extraField ? { [extraField]: z.string() } : {})
  })

const sensitive = (inner: z.ZodType) =>
  zx.codec(inner, inner, {
    decode: (w: any) => w,
    encode: (r: any) => r
  })

describe('codegen determinism', () => {
  it('shuffled model/function input produces byte-identical output', () => {
    const docA = buildModelDoc('a')
    const docB = buildModelDoc('b')
    const docC = buildModelDoc('c')

    const models: DiscoveredModel[] = [
      {
        exportName: 'AModel',
        tableName: 'as',
        sourceFile: 'models/a.ts',
        schemas: {
          doc: docA,
          insert: z.object({ name: z.string(), a: z.string() }),
          update: z.object({ name: z.string().optional(), a: z.string().optional() }),
          docArray: z.array(docA),
          paginatedDoc: z.object({
            page: z.array(docA),
            isDone: z.boolean(),
            continueCursor: z.string()
          })
        }
      },
      {
        exportName: 'BModel',
        tableName: 'bs',
        sourceFile: 'models/b.ts',
        schemas: {
          doc: docB,
          insert: z.object({ name: z.string(), b: z.string() }),
          update: z.object({ name: z.string().optional(), b: z.string().optional() }),
          docArray: z.array(docB),
          paginatedDoc: z.object({
            page: z.array(docB),
            isDone: z.boolean(),
            continueCursor: z.string()
          })
        }
      },
      {
        exportName: 'CModel',
        tableName: 'cs',
        sourceFile: 'models/c.ts',
        schemas: {
          doc: docC,
          insert: z.object({ name: z.string(), c: z.string() }),
          update: z.object({ name: z.string().optional(), c: z.string().optional() }),
          docArray: z.array(docC),
          paginatedDoc: z.object({
            page: z.array(docC),
            isDone: z.boolean(),
            continueCursor: z.string()
          })
        }
      }
    ]

    const functions: DiscoveredFunction[] = [
      {
        functionPath: 'as:get',
        exportName: 'get',
        sourceFile: 'as.ts',
        zodArgs: z.object({ id: zx.id('as') }),
        zodReturns: docA.nullable()
      },
      {
        functionPath: 'bs:get',
        exportName: 'get',
        sourceFile: 'bs.ts',
        zodArgs: z.object({ id: zx.id('bs') }),
        zodReturns: docB.nullable()
      },
      {
        functionPath: 'cs:get',
        exportName: 'get',
        sourceFile: 'cs.ts',
        zodArgs: z.object({ id: zx.id('cs') }),
        zodReturns: docC.nullable()
      }
    ]

    // Baseline: emit in declared order.
    const baseline = generateApiFile(functions, models)

    // Shuffle every input collection. With pre-fix code this would change
    // both the order of emitted import lines and the order of registry
    // entries. With the sort guarantees in place, output must match.
    const reversed = generateApiFile([...functions].reverse(), [...models].reverse())

    expect(reversed.js).toBe(baseline.js)
    expect(reversed.dts).toBe(baseline.dts)

    // Also try a fully randomized permutation by index-cycling.
    const cycled = generateApiFile(
      [functions[2], functions[0], functions[1]],
      [models[1], models[2], models[0]]
    )
    expect(cycled.js).toBe(baseline.js)
  })

  it('codecs and model/function codecs sort deterministically', () => {
    const codecA = sensitive(z.string())
    const codecB = sensitive(z.string())

    const codecs: CodecForGeneration[] = [
      { exportName: 'aCodec', sourceFile: 'codecs/a.ts', schema: codecA },
      { exportName: 'bCodec', sourceFile: 'codecs/b.ts', schema: codecB }
    ]
    const baseline = generateApiFile([], [], codecs)
    const reversed = generateApiFile([], [], [...codecs].reverse())

    expect(reversed.js).toBe(baseline.js)
  })

  it('shared-fingerprint function codec with same-source-file candidate resolves deterministically', () => {
    // Two codecs with the same fingerprint, only one of which shares a
    // source file with the function. The same-file candidate must win
    // regardless of input order.
    const codecAlpha = sensitive(z.string())
    const codecBravo = sensitive(z.string())
    const fnCodec = sensitive(z.string()) // same fingerprint as both

    const codecs: CodecForGeneration[] = [
      { exportName: 'alpha', sourceFile: 'codecs/alpha.ts', schema: codecAlpha },
      { exportName: 'bravo', sourceFile: 'codecs/bravo.ts', schema: codecBravo }
    ]

    const functions: DiscoveredFunction[] = [
      {
        functionPath: 'alpha:run',
        exportName: 'run',
        sourceFile: 'codecs/alpha.ts',
        zodArgs: z.object({ payload: fnCodec }),
        zodReturns: undefined
      }
    ]

    const functionCodecs: FunctionEmbeddedCodec[] = [
      {
        codec: fnCodec,
        functionExportName: 'run',
        functionSourceFile: 'codecs/alpha.ts',
        schemaSource: 'zodArgs',
        accessPath: '.shape.payload'
      }
    ]

    const out1 = generateApiFile(functions, [], codecs, [], functionCodecs)
    const out2 = generateApiFile(functions, [], [...codecs].reverse(), [], functionCodecs)
    expect(out2.js).toBe(out1.js)
    // The same-source-file codec ('alpha') should be referenced — never 'bravo'.
    expect(out1.js).toMatch(/alpha/)
    expect(out1.js).not.toMatch(/bravo/)
  })

  it('shared-fingerprint function codec without same-source-file candidate picks a deterministic reference', () => {
    const codecAlpha = sensitive(z.string())
    const codecBravo = sensitive(z.string())
    const fnCodec = sensitive(z.string())

    const codecs: CodecForGeneration[] = [
      { exportName: 'alpha', sourceFile: 'codecs/alpha.ts', schema: codecAlpha },
      { exportName: 'bravo', sourceFile: 'codecs/bravo.ts', schema: codecBravo }
    ]

    const functions: DiscoveredFunction[] = [
      {
        functionPath: 'somewhere/else:run',
        exportName: 'run',
        sourceFile: 'somewhere/else.ts',
        zodArgs: z.object({ payload: fnCodec }),
        zodReturns: undefined
      }
    ]
    const functionCodecs: FunctionEmbeddedCodec[] = [
      {
        codec: fnCodec,
        functionExportName: 'run',
        functionSourceFile: 'somewhere/else.ts',
        schemaSource: 'zodArgs',
        accessPath: '.shape.payload'
      }
    ]

    const result = generateApiFile(functions, [], codecs, [], functionCodecs)
    // The candidates are fingerprint-equivalent (same wire+runtime+transform),
    // so any one is a behaviorally-correct reference. We must NEVER inline a
    // transform-less husk (that silently breaks the client codec path with no
    // build signal). Pick the stable-sorted-first candidate so output stays
    // deterministic across discovery order (hotpot MR 206).
    expect(result.js).not.toMatch(/transforms lost/)
    expect(result.js).toMatch(/alpha/)
    expect(result.js).not.toMatch(/bravo/)

    // Deterministic regardless of input order.
    const reversed = generateApiFile(functions, [], [...codecs].reverse(), [], functionCodecs)
    expect(reversed.js).toBe(result.js)
  })

  it('codecs with the same shape but different transforms get distinct fingerprints', () => {
    // Same wire+runtime types, different transform bodies. Structure-only
    // fingerprinting conflated these; transform-aware fingerprinting must keep
    // them distinct so the matching-transform codec is the only candidate.
    const upper = zx.codec(z.string(), z.string(), {
      decode: (w: any) => w.toUpperCase(),
      encode: (r: any) => r.toLowerCase()
    })
    const lower = zx.codec(z.string(), z.string(), {
      decode: (w: any) => w.toLowerCase(),
      encode: (r: any) => r.toUpperCase()
    })
    // fnCodec shares `upper`'s transform bodies exactly.
    const fnCodec = zx.codec(z.string(), z.string(), {
      decode: (w: any) => w.toUpperCase(),
      encode: (r: any) => r.toLowerCase()
    })

    // Place the WRONG-transform candidate so it sorts first — proving the
    // transform, not sort order, is what disambiguates.
    const codecs: CodecForGeneration[] = [
      { exportName: 'lowerCodec', sourceFile: 'codecs/aaa.ts', schema: lower },
      { exportName: 'upperCodec', sourceFile: 'codecs/zzz.ts', schema: upper }
    ]
    const functions: DiscoveredFunction[] = [
      {
        functionPath: 'mod:run',
        exportName: 'run',
        sourceFile: 'mod.ts',
        zodArgs: z.object({ payload: fnCodec }),
        zodReturns: undefined
      }
    ]
    const functionCodecs: FunctionEmbeddedCodec[] = [
      {
        codec: fnCodec,
        functionExportName: 'run',
        functionSourceFile: 'mod.ts',
        schemaSource: 'zodArgs',
        accessPath: '.shape.payload'
      }
    ]

    const result = generateApiFile(functions, [], codecs, [], functionCodecs)
    expect(result.js).toMatch(/upperCodec/)
    expect(result.js).not.toMatch(/lowerCodec/)
    expect(result.js).not.toMatch(/transforms lost/)
  })

  it('codecs with same wire/runtime types but different checks get distinct fingerprints', () => {
    // sensitive(z.string()) and sensitive(z.string().max(100)) used to collide.
    // After fingerprint tightening they must not — otherwise the ambiguity path
    // would treat them as the same codec and pick by candidate-list order.
    const codecPlain = sensitive(z.string())
    const codecBounded = sensitive(z.string().max(100))
    const fnCodec = sensitive(z.string()) // matches only the plain candidate

    const codecs: CodecForGeneration[] = [
      { exportName: 'plain', sourceFile: 'codecs/plain.ts', schema: codecPlain },
      { exportName: 'bounded', sourceFile: 'codecs/bounded.ts', schema: codecBounded }
    ]

    const functions: DiscoveredFunction[] = [
      {
        functionPath: 'mod:run',
        exportName: 'run',
        sourceFile: 'mod.ts',
        zodArgs: z.object({ payload: fnCodec }),
        zodReturns: undefined
      }
    ]
    const functionCodecs: FunctionEmbeddedCodec[] = [
      {
        codec: fnCodec,
        functionExportName: 'run',
        functionSourceFile: 'mod.ts',
        schemaSource: 'zodArgs',
        accessPath: '.shape.payload'
      }
    ]

    const result = generateApiFile(functions, [], codecs, [], functionCodecs)
    // The bounded candidate has a different fingerprint, so the plain
    // candidate is the only match and should be used.
    expect(result.js).toMatch(/plain/)
    expect(result.js).not.toMatch(/bounded/)
  })
})
