/**
 * Each entrypoint bundles its own copy of the id module, so an id built by
 * one bundle must still map to v.id() in another (e.g. zx from `zodvex`,
 * defineZodSchema from `zodvex/server`).
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as root from '../dist/index.js'
import * as server from '../dist/server/index.js'

describe('zx.id across built bundles', () => {
  it('maps to v.id when the schema is defined through zodvex/server', () => {
    const model = root.defineZodModel('calls', {
      visitId: root.zx.id('visits'),
      parentId: z.optional(root.zx.id('calls'))
    })
    const schema = server.defineZodSchema({ calls: model })
    const { visitId, parentId } = schema.tables.calls.validator.fields

    expect({ kind: visitId.kind, tableName: visitId.tableName }).toEqual({
      kind: 'id',
      tableName: 'visits'
    })
    expect({ kind: parentId.kind, tableName: parentId.tableName }).toEqual({
      kind: 'id',
      tableName: 'calls'
    })
  })
})
