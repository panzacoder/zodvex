/**
 * Each entrypoint bundles its own copy of the id module, so an id built by
 * one bundle must still map to v.id() in another (e.g. zx from `zodvex`,
 * defineZodSchema from `zodvex/server`).
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
// @ts-expect-error built output has no adjacent types
import * as root from '../dist/index.js'
// @ts-expect-error built output has no adjacent types
import * as server from '../dist/server/index.js'

describe('zx.id across built bundles', () => {
  it('maps to v.id when the schema is defined through zodvex/server', () => {
    const model = root.defineZodModel('calls', {
      visitId: root.zx.id('visits'),
      parentId: z.optional(root.zx.id('calls'))
    })
    const schema = server.defineZodSchema({ calls: model })
    const fields = JSON.parse(schema.export()).tables[0].documentType.value

    expect(fields.visitId.fieldType).toEqual({ type: 'id', tableName: 'visits' })
    expect(fields.parentId.fieldType).toEqual({ type: 'id', tableName: 'calls' })
  })
})
