import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverModules } from '../src/public/codegen/discover'

// Regression coverage for the `zodvex dev` watcher bug Heath reported:
// the debounced regen on file change saw the OLD module from the ESM cache
// and produced identical output, making it look like changes weren't picked
// up. `discoverModules` now appends a per-run cache-busting query string to
// each dynamic import so successive runs in the same process pick up edits.

describe('discoverModules: per-run cache-busting', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'zodvex-watch-test-'))
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('successive discoverModules() calls see edits between runs', async () => {
    // Plain .js fixture with the zodvex meta attached directly as a property —
    // avoids needing any package-relative imports from inside the tmp dir.
    const modulePath = path.join(tmpRoot, 'jobs.js')

    const moduleSource = (label: string) => `
const handler = () => '${label}'
Object.defineProperty(handler, '__zodvexMeta', {
  value: { type: 'function' },
  enumerable: false
})
export const ${label} = handler
`

    writeFileSync(modulePath, moduleSource('alpha'))
    const first = await discoverModules(tmpRoot, { freshImports: true })
    const firstExports = first.functions.map(f => f.exportName).sort()
    expect(firstExports).toEqual(['alpha'])

    // Edit the file to export a different symbol. Without freshImports,
    // the second dynamic import would return the cached module from the
    // first run and the result would still contain 'alpha'.
    writeFileSync(modulePath, moduleSource('bravo'))
    const second = await discoverModules(tmpRoot, { freshImports: true })
    const secondExports = second.functions.map(f => f.exportName).sort()
    expect(secondExports).toEqual(['bravo'])
  })
})
