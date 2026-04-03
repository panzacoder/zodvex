#!/usr/bin/env bun
import { dev, generate } from './commands'

const command = process.argv[2]
const miniFlag = process.argv.includes('--mini')
// The convex dir arg needs to skip flags
const convexDir = process.argv.slice(3).find(a => !a.startsWith('--'))

async function main() {
  switch (command) {
    case 'generate':
      await generate(convexDir, { mini: miniFlag })
      break
    case 'dev':
      await dev(convexDir, { mini: miniFlag })
      break
    case 'init': {
      // Dynamic import to keep init dependencies lazy
      const { init } = await import('./init')
      await init()
      break
    }
    case 'migrate': {
      const { migrate } = await import('./migrate')
      const targetDir = process.argv[3] ?? '.'
      const dryRun = process.argv.includes('--dry-run')
      const result = migrate(targetDir, { dryRun })

      if (dryRun) {
        console.log(`[zodvex] Dry run: ${result.wouldChange} file(s) would be changed`)
      } else {
        console.log(`[zodvex] Migrated ${result.filesChanged} file(s)`)
      }

      if (result.remainingDeprecations.length > 0) {
        console.log('')
        console.log('[zodvex] Remaining deprecated API usage:')
        const grouped = new Map<string, string[]>()
        for (const d of result.remainingDeprecations) {
          const key = d.symbol
          if (!grouped.has(key)) grouped.set(key, [])
          grouped.get(key)?.push(`  ${d.file}:${d.line}`)
        }
        for (const [symbol, locations] of grouped) {
          console.log(`  ${symbol}:`)
          for (const loc of locations) {
            console.log(`    ${loc}`)
          }
        }
        console.log('')
        console.log('See docs/migration/v0.6.md for migration guidance on structural changes.')
      }
      break
    }
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printHelp()
      break
    default:
      console.error(`Unknown command: ${command}`)
      printHelp()
      process.exit(1)
  }
}

function printHelp() {
  console.log(`
zodvex - Convex codegen for Zod schemas

Usage:
  zodvex generate [convex-dir] [--mini]  Generate schema and validator files
  zodvex dev [convex-dir] [--mini]       Watch mode — regenerate on changes
  zodvex init                            Set up zodvex in an existing Convex project
  zodvex migrate [dir]                   Migrate pre-0.6 APIs (renames + import fixes)
  zodvex migrate [dir] --dry-run         Preview changes without writing
  zodvex help                            Show this help message

Flags:
  --mini  Emit zod/mini-compatible output (functional forms, zodvex/mini imports)
`)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
