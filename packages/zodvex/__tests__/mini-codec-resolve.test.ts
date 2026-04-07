/**
 * Verifies that ConvexValidatorFromZod resolves ZxMiniDate correctly.
 * If this fails, the mapping layer can't extract wire types from codec fields.
 */

import type { VFloat64 } from 'convex/values'
import { describe, expectTypeOf, it } from 'vitest'
import type { ConvexValidatorFromZod } from '../src/mapping/types'
import type { ZxMiniDate } from '../src/mini'
import type { ZxDate } from '../src/zx'

describe('codec type resolution', () => {
  it('ZxDate (full) resolves to VFloat64', () => {
    type Result = ConvexValidatorFromZod<ZxDate, 'required'>
    expectTypeOf<Result>().toMatchTypeOf<VFloat64<number, 'required'>>()
  })

  it('ZxMiniDate resolves to VFloat64', () => {
    type Result = ConvexValidatorFromZod<ZxMiniDate, 'required'>
    expectTypeOf<Result>().toMatchTypeOf<VFloat64<number, 'required'>>()
  })
})
