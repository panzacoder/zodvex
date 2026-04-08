import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canResolve } from '../src/public/codegen/detect'

// Use this file's directory so resolution traverses packages/zodvex/node_modules
// (where bun hoists workspace deps) rather than the monorepo root.
const fromDir = dirname(fileURLToPath(import.meta.url))

describe('canResolve', () => {
  it('returns true for installed packages', () => {
    // zod is a peer dependency resolvable from this package
    expect(canResolve('zod', fromDir)).toBe(true)
  })

  it('returns false for uninstalled packages', () => {
    expect(canResolve('nonexistent-package-xyz-12345', fromDir)).toBe(false)
  })
})
