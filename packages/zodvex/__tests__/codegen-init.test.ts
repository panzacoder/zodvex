import { describe, expect, it } from 'vitest'
import {
  ensureConcurrently,
  gitignoreEntry,
  rewriteDeployScript,
  rewriteDevScript
} from '../src/public/cli/init'

describe('rewriteDevScript', () => {
  it('wraps bunx convex dev', () => {
    expect(rewriteDevScript('bunx convex dev')).toBe('concurrently "zodvex dev" "bunx convex dev"')
  })

  it('wraps npx convex dev', () => {
    expect(rewriteDevScript('npx convex dev')).toBe('concurrently "zodvex dev" "npx convex dev"')
  })

  it('returns null for scripts without convex dev', () => {
    expect(rewriteDevScript('tsc --noEmit')).toBeNull()
  })

  it('returns null if already wrapped', () => {
    expect(rewriteDevScript('concurrently "zodvex dev" "bunx convex dev"')).toBeNull()
  })
})

describe('rewriteDeployScript', () => {
  it('prefixes bunx convex deploy', () => {
    expect(rewriteDeployScript('bunx convex deploy')).toBe('zodvex generate && bunx convex deploy')
  })

  it('prefixes npx convex deploy', () => {
    expect(rewriteDeployScript('npx convex deploy')).toBe('zodvex generate && npx convex deploy')
  })

  it('inserts before convex deploy in chained scripts', () => {
    expect(rewriteDeployScript('tsc && bunx convex deploy')).toBe(
      'tsc && zodvex generate && bunx convex deploy'
    )
  })

  it('returns null if already wrapped', () => {
    expect(rewriteDeployScript('zodvex generate && bunx convex deploy')).toBeNull()
  })

  it('returns null for scripts without convex deploy', () => {
    expect(rewriteDeployScript('npm run build')).toBeNull()
  })
})

describe('ensureConcurrently', () => {
  it('returns add when not present', () => {
    expect(ensureConcurrently({ devDependencies: {} })).toBe('add')
  })

  it('returns exists when already present in devDependencies', () => {
    expect(ensureConcurrently({ devDependencies: { concurrently: '^9.0.0' } })).toBe('exists')
  })

  it('returns exists when already present in dependencies', () => {
    expect(ensureConcurrently({ dependencies: { concurrently: '^9.0.0' } })).toBe('exists')
  })
})

describe('gitignoreEntry', () => {
  it('adds entry to empty content', () => {
    const result = gitignoreEntry('')
    expect(result).toContain('convex/_zodvex/')
  })

  it('appends entry to existing content', () => {
    const result = gitignoreEntry('node_modules\n.env')
    expect(result).toContain('convex/_zodvex/')
    expect(result).toContain('node_modules')
  })

  it('returns null if already present', () => {
    expect(gitignoreEntry('convex/_zodvex/')).toBeNull()
  })

  it('returns null if already present among other entries', () => {
    expect(gitignoreEntry('convex/_zodvex/\nnode_modules')).toBeNull()
  })
})
