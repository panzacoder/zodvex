#!/usr/bin/env bun
/**
 * Compiles convex/ source files from full-zod to zod/mini into a shadow directory.
 *
 * This is the "path 3" workflow: write your code with full zod,
 * compile to zod/mini before deploying to Convex. You get full-zod
 * DX during development and zod/mini's 51% memory savings in production.
 *
 * The original convex/ directory is never modified.
 *
 * Usage:
 *   bun run scripts/compile-mini.ts
 */
import { transformCode, transformImports } from 'zod-to-mini'
import { Project } from 'ts-morph'
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from 'fs'
import { globSync } from 'fs'
import { resolve, relative, dirname } from 'path'

const projectRoot = resolve(import.meta.dir, '..')
const sourceDir = resolve(projectRoot, 'convex')
const outputDir = resolve(projectRoot, 'convex-mini')

// Clean and copy convex/ → convex-mini/
// Exclude _generated/ (Convex will regenerate) and _zodvex/ (zodvex will regenerate)
if (existsSync(outputDir)) {
  rmSync(outputDir, { recursive: true })
}
cpSync(sourceDir, outputDir, {
  recursive: true,
  filter: (src) => {
    const rel = relative(sourceDir, src)
    if (rel.startsWith('_generated')) return false
    if (rel.startsWith('_zodvex')) return false
    return true
  },
})

console.log('[compile-mini] Copied convex/ → convex-mini/ (excluding _generated/, _zodvex/)')

// Find all .ts files in convex-mini/
const files = globSync('**/*.ts', { cwd: outputDir })
  .filter(f => !f.endsWith('.d.ts'))
  .map(f => resolve(outputDir, f))

console.log(`[compile-mini] Processing ${files.length} files...`)

let totalChanged = 0

for (const filePath of files) {
  const code = readFileSync(filePath, 'utf-8')

  // Skip files that don't reference zod or zodvex imports
  const hasZodImport = /from\s+['"]zod['"]/.test(code)
  const hasZodvexImport = /from\s+['"]zodvex(?:\/\w+)?['"]/.test(code)
  if (!hasZodImport && !hasZodvexImport) continue

  // Apply all zod→mini code transforms
  const result = transformCode(code)
  let output = result.code

  // Transform imports: 'zod' → 'zod/mini', 'zodvex/core' → 'zodvex/mini'
  const project = new Project({ useInMemoryFileSystem: true })
  const sf = project.createSourceFile('tmp.ts', output)
  transformImports(sf)
  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue()
    if (spec === 'zodvex/core') imp.setModuleSpecifier('zodvex/mini')
  }

  // If transforms introduced z.* calls but the file has no z import, add one
  const hasZImport = sf.getImportDeclarations().some(imp => {
    const named = imp.getNamedImports().map(n => n.getName())
    const defaultImport = imp.getDefaultImport()?.getText()
    return named.includes('z') || defaultImport === 'z'
  })
  if (!hasZImport && sf.getFullText().match(/\bz\.\w+\(/)) {
    sf.addImportDeclaration({
      moduleSpecifier: 'zod/mini',
      namedImports: ['z'],
    })
  }

  output = sf.getFullText()

  if (output !== code) {
    totalChanged++
    writeFileSync(filePath, output)
    console.log(`  compiled: ${relative(projectRoot, filePath)}`)
  }
}

console.log(`[compile-mini] ${totalChanged} file(s) compiled.`)
console.log('[compile-mini] Output: convex-mini/')
console.log('[compile-mini] Deploy with: bunx convex deploy --config convex.mini.json')
