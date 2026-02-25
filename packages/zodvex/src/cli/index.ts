#!/usr/bin/env bun
import { dev, generate } from './commands'

const command = process.argv[2]
const convexDir = process.argv[3]

async function main() {
  switch (command) {
    case 'generate':
      await generate(convexDir)
      break
    case 'dev':
      await dev(convexDir)
      break
    case 'init': {
      // Dynamic import to keep init dependencies lazy
      const { init } = await import('./init')
      await init()
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
  zodvex generate [convex-dir]  Generate schema and validator files
  zodvex dev [convex-dir]       Watch mode — regenerate on changes
  zodvex init                   Set up zodvex in an existing Convex project
  zodvex help                   Show this help message
`)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
