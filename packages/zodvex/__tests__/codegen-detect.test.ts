import { describe, expect, it } from 'bun:test'
import { canResolve, detectFormIntegrations } from '../src/codegen/detect'

// Use import.meta.dir so resolution traverses packages/zodvex/node_modules
// (where bun hoists workspace deps) rather than the monorepo root.
const fromDir = import.meta.dir

describe('canResolve', () => {
  it('returns true for installed packages', () => {
    // zod is a peer dependency resolvable from this package
    expect(canResolve('zod', fromDir)).toBe(true)
  })

  it('returns false for uninstalled packages', () => {
    expect(canResolve('nonexistent-package-xyz-12345', fromDir)).toBe(false)
  })
})

describe('detectFormIntegrations', () => {
  it('detects mantine-form-zod-resolver when installed', () => {
    // mantine-form-zod-resolver is a dev dependency in this repo
    const result = detectFormIntegrations(fromDir)
    expect(result.form?.mantine).toBe(true)
  })
})
