#!/usr/bin/env bun
/**
 * CLI for zod-to-mini codemod.
 *
 * Usage:
 *   bun run packages/zod-to-mini/src/cli.ts <glob> [--dry-run] [--transform-imports]
 *
 * Examples:
 *   bun run packages/zod-to-mini/src/cli.ts 'packages/zodvex/__tests__/**\/*.test.ts' --dry-run
 *   bun run packages/zod-to-mini/src/cli.ts 'src/**\/*.ts' --transform-imports
 */
import { Project } from 'ts-morph'
import { transformFile, type TransformResult } from './transforms'
import { globSync } from 'fs'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const transformImportsFlag = args.includes('--transform-imports')
const globs = args.filter(a => !a.startsWith('--'))

if (globs.length === 0) {
  console.log('Usage: zod-to-mini <glob> [--dry-run] [--transform-imports]')
  console.log('')
  console.log('Options:')
  console.log('  --dry-run            Show changes without writing files')
  console.log('  --transform-imports  Also change import { z } from "zod" → "zod/mini"')
  process.exit(1)
}

const project = new Project({
  tsConfigFilePath: undefined,
  skipAddingFilesFromTsConfig: true,
})

// Add files matching the glob
for (const glob of globs) {
  project.addSourceFilesAtPaths(glob)
}

const files = project.getSourceFiles()
console.log(`[zod-to-mini] Processing ${files.length} files${dryRun ? ' (dry run)' : ''}...`)
console.log('')

const results: TransformResult[] = []
let totalChanges = 0
let totalWarnings = 0

for (const file of files) {
  let result: TransformResult
  try {
    result = transformFile(file)
  } catch (e) {
    const shortPath = file.getFilePath().split('zodvex/').pop() || file.getFilePath()
    console.error(`  ERROR ${shortPath}: ${(e as Error).message?.slice(0, 100)}`)
    continue
  }

  // Optionally transform imports
  if (transformImportsFlag) {
    const { transformImports } = await import('./transforms')
    result.imports = transformImports(file)
    result.totalChanges += result.imports
  }

  if (result.totalChanges > 0 || result.objectOnlyWarnings.length > 0 || result.propertyAccessWarnings.length > 0) {
    results.push(result)
    totalChanges += result.totalChanges

    const shortPath = result.filePath.split('zodvex/').pop() || result.filePath
    console.log(`  ${shortPath}:`)
    if (result.wrappers > 0) console.log(`    ${result.wrappers} wrapper(s) → functional form`)
    if (result.checks > 0) console.log(`    ${result.checks} check(s) → .check(z.method())`)
    if (result.methods > 0) console.log(`    ${result.methods} method(s) → top-level function`)
    if (result.propertyAccessors > 0) console.log(`    ${result.propertyAccessors} property accessor(s) → ._zod.def.*`)
    if (result.classRefs > 0) console.log(`    ${result.classRefs} class ref(s) → core types`)
    if (result.imports > 0) console.log(`    ${result.imports} import(s) → zod/mini`)

    for (const warn of result.objectOnlyWarnings) {
      console.log(`    ⚠ line ${warn.line}: .${warn.method}() — no mini equivalent, needs manual fix`)
      totalWarnings++
    }
    for (const warn of result.propertyAccessWarnings) {
      console.log(`    ⚠ line ${warn.line}: .${warn.property} — use ._zod.def.${warn.property} in mini`)
      totalWarnings++
    }
  }
}

console.log('')
console.log(`[zod-to-mini] ${totalChanges} change(s) across ${results.length} file(s)`)
if (totalWarnings > 0) {
  console.log(`[zod-to-mini] ${totalWarnings} warning(s) — methods with no mini equivalent`)
}

if (!dryRun && totalChanges > 0) {
  project.saveSync()
  console.log('[zod-to-mini] Files saved.')
} else if (dryRun && totalChanges > 0) {
  console.log('[zod-to-mini] Dry run — no files written.')
}
