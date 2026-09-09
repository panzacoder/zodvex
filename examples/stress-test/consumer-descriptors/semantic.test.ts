import { describe, expect, it } from 'vitest'
import { characterize } from './semantic'

describe('PR80 descriptor strategy on current runtime', () => {
  it('preserves the full baseline and exposes each known compatibility failure', async () => {
    const result = await characterize()
    expect(result.baselinePasses).toBe(true)
    expect(result.rows).toHaveLength(25)
    expect(result.mismatches).toEqual([
      'ordinary invalid read rejected', 'ordinary invalid insert rejected',
      'ordinary missing insert rejected', 'ordinary invalid replace rejected',
      'ordinary read refinement retained', 'custom read refinement retained',
      'ordinary read default retained', 'codec read default retained',
      'ordinary read transform retained', 'invalid union codec read rejected',
      'wire-valid invalid union codec rejected',
      'unknown union discriminator rejected', 'wrapped operation: ordinaryPatch',
    ])
  })
})
