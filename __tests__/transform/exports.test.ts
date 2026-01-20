/**
 * Tests for transform module public API surface.
 *
 * Ensures all expected exports are available and prevents accidental breaking changes.
 */

import { describe, expect, it } from 'bun:test'
import * as transform from '../../src/transform'

describe('transform module exports', () => {
  it('should export all expected functions', () => {
    const expectedExports = [
      'findFieldsWithMeta',
      'getMetadata',
      'hasMetadata',
      'transformBySchema',
      'transformBySchemaAsync',
      'walkSchema'
    ]

    const actualExports = Object.keys(transform).sort()
    expect(actualExports).toEqual(expectedExports)
  })

  it('should export functions with correct types', () => {
    expect(typeof transform.findFieldsWithMeta).toBe('function')
    expect(typeof transform.getMetadata).toBe('function')
    expect(typeof transform.hasMetadata).toBe('function')
    expect(typeof transform.transformBySchema).toBe('function')
    expect(typeof transform.transformBySchemaAsync).toBe('function')
    expect(typeof transform.walkSchema).toBe('function')
  })
})
