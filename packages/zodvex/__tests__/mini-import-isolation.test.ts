/**
 * Import isolation test for zodvex/mini.
 *
 * Verifies that the built mini entrypoint contains no references to
 * bare 'zod' (full) — only 'zod/mini' and 'zod/v4/core'.
 * This catches regressions where the esbuild alias plugin fails to
 * rewrite an import.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const distDir = resolve(__dirname, '../dist/mini')

function readBuiltFile(name: string): string {
  return readFileSync(resolve(distDir, name), 'utf-8')
}

describe('mini build: import isolation', () => {
  it('dist/mini/index.js has no bare zod imports', () => {
    const content = readBuiltFile('index.js')
    // Match 'zod' but not 'zod/mini' or 'zod/v4/core'
    const bareZodImports = content.match(/from\s+['"]zod['"]/g)
    expect(bareZodImports).toBeNull()
  })

  it('dist/mini/index.js imports from zod/mini', () => {
    const content = readBuiltFile('index.js')
    expect(content).toContain("from 'zod/mini'")
  })

  it('dist/mini/server/index.js has no bare zod imports', () => {
    const content = readBuiltFile('server/index.js')
    const bareZodImports = content.match(/from\s+['"]zod['"]/g)
    expect(bareZodImports).toBeNull()
  })

  it('dist/mini/server/index.js imports from zod/mini', () => {
    const content = readBuiltFile('server/index.js')
    expect(content).toContain("from 'zod/mini'")
  })
})
