/**
 * zodvex codemod --to-mini
 *
 * One-time migration from full-zod to zod/mini syntax.
 * Transforms method chains to functional forms, rewrites imports.
 *
 * This modifies files in-place. Use --dry-run to preview changes.
 * To undo: git restore <dir>
 */
import { readFileSync, writeFileSync } from 'fs'
import { relative, resolve } from 'path'
import { globSync } from 'tinyglobby'

export async function runToMiniCodemod(
  targetDir: string,
  options: { dryRun?: boolean } = {}
): Promise<void> {
  // Import directly from workspace package (not zodvex/labs which is the published re-export)
  const { transformCode, transformImports } = await import('zod-to-mini')
  const { Project } = await import('ts-morph')

  const dir = resolve(process.cwd(), targetDir)
  const files = globSync(['**/*.ts', '**/*.tsx'], {
    cwd: dir,
    ignore: ['_generated/**', '_zodvex/**', '**/*.d.ts', 'node_modules/**'],
    absolute: true
  })

  console.log(
    `[zodvex codemod] ${options.dryRun ? 'Dry run — ' : ''}Processing ${files.length} files in ${targetDir}/`
  )
  console.log('')

  let totalChanged = 0

  for (const filePath of files) {
    const code = readFileSync(filePath, 'utf-8')

    // Skip files that don't reference zod
    if (!code.includes("'zod'") && !code.includes('"zod"')) continue

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
    output = sf.getFullText()

    if (output !== code) {
      totalChanged++
      const rel = relative(process.cwd(), filePath)
      if (options.dryRun) {
        console.log(`  would change: ${rel}`)
      } else {
        writeFileSync(filePath, output)
        console.log(`  changed: ${rel}`)
      }
    }
  }

  console.log('')
  console.log(
    `[zodvex codemod] ${totalChanged} file(s) ${options.dryRun ? 'would be changed' : 'changed'}.`
  )

  if (!options.dryRun && totalChanged > 0) {
    console.log('')
    console.log('Next steps:')
    console.log('  1. Run `zodvex generate --mini` to regenerate codegen output')
    console.log('  2. Run your type-checker and tests to verify')
    console.log('  3. To undo: git restore ' + targetDir + '/')
  }
}
