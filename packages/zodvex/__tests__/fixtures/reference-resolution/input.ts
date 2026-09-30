import { z } from 'zod'
import { zx } from '../../../src/internal/zx'
import type { DiscoveredFunction, DiscoveredModel } from '../../../src/public/codegen/discover'
import { walkFunctionCodecs, walkModelCodecs } from '../../../src/public/codegen/discover'

export function referenceResolutionInput() {
  const namedCodec = zx.codec(
    z.string(),
    z.string(),
    {
      decode: value => value.toUpperCase(),
      encode: value => value.toLowerCase()
    },
    { brand: 'case' }
  )
  const embeddedCodec = zx.codec(z.number(), z.number(), {
    decode: value => value * 2,
    encode: value => value / 2
  })
  const insert = z.object({ title: z.string(), at: zx.date(), amount: embeddedCodec })
  const doc = insert.extend({ _id: zx.id('items'), _creationTime: z.number() })
  const model: DiscoveredModel = {
    exportName: 'ItemModel',
    sourceFile: 'models/item.ts',
    tableName: 'items',
    schemas: {
      doc,
      insert,
      update: insert.partial(),
      docArray: z.array(doc),
      paginatedDoc: zx.paginationResult(doc)
    }
  }
  const factoryCodec = zx.codec(
    z.string(),
    z.string(),
    {
      decode: value => value.toUpperCase(),
      encode: value => value.toLowerCase()
    },
    { brand: 'case' }
  )
  const functions: DiscoveredFunction[] = [
    {
      functionPath: 'items:get',
      exportName: 'get',
      sourceFile: 'items.ts',
      zodArgs: z.object({ id: zx.id('items') }),
      zodReturns: doc.nullable()
    },
    {
      functionPath: 'items:update',
      exportName: 'update',
      sourceFile: 'items.ts',
      zodArgs: doc.partial(),
      zodReturns: z.boolean()
    },
    {
      functionPath: 'items:convert',
      exportName: 'convert',
      sourceFile: 'items.ts',
      zodArgs: z.object({ text: factoryCodec, amount: embeddedCodec }),
      zodReturns: embeddedCodec
    },
    { functionPath: 'items:raw', exportName: 'raw', sourceFile: 'items.ts' }
  ]
  return {
    functions,
    models: [model],
    codecs: [{ exportName: 'caseCodec', sourceFile: 'codecs/case.ts', schema: namedCodec }],
    modelCodecs: walkModelCodecs(model.exportName, model.sourceFile, model.schemas),
    functionCodecs: walkFunctionCodecs(functions),
    runtime: { namedCodec, embeddedCodec, model }
  }
}
