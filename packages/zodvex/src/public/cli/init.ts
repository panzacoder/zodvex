/**
 * zodvex init — set up zodvex in an existing Convex project.
 * Pure helper functions + interactive init orchestrator.
 */

import fs from 'node:fs'
import path from 'node:path'

/**
 * Rewrites a dev script to run zodvex dev alongside convex dev using concurrently.
 * Returns null if the script doesn't contain `convex dev` or is already wrapped.
 */
export function rewriteDevScript(script: string): string | null {
  if (script.includes('zodvex dev')) return null
  const match = script.match(/\b((?:bunx|npx)\s+convex\s+dev)\b/)
  if (!match) return null
  return `concurrently "zodvex dev" "${script}"`
}

/**
 * Rewrites a deploy script to run zodvex generate before convex deploy.
 * Returns null if the script doesn't contain `convex deploy` or is already wrapped.
 */
export function rewriteDeployScript(script: string): string | null {
  if (script.includes('zodvex generate')) return null
  const match = script.match(/\b((?:bunx|npx)\s+convex\s+deploy)\b/)
  if (!match) return null
  const idx = script.indexOf(match[1])
  const before = script.slice(0, idx)
  const after = script.slice(idx)
  return `${before}zodvex generate && ${after}`
}

/**
 * Checks if concurrently is installed in the project.
 * Returns 'add' if it needs to be installed, 'exists' if already present.
 */
export function ensureConcurrently(pkg: {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}): 'add' | 'exists' {
  if (pkg.dependencies?.concurrently) return 'exists'
  if (pkg.devDependencies?.concurrently) return 'exists'
  return 'add'
}

/**
 * Returns updated .gitignore content with the convex/_zodvex/ entry,
 * or null if the entry already exists.
 */
export function gitignoreEntry(content: string): string | null {
  if (content.includes('convex/_zodvex/')) return null
  const lines = content ? content.split('\n') : []
  lines.push('# zodvex generated files', 'convex/_zodvex/')
  return lines.join('\n')
}

/**
 * Generates stub files in _zodvex/ so that imports resolve before the first
 * codegen run. Called by `zodvex init` and can also be called standalone.
 *
 * Creates:
 * - _zodvex/api.ts — empty registry stub
 * - _zodvex/client.ts — stub that imports from the api stub
 */
export function generateStubs(convexDir: string): void {
  const zodvexDir = path.join(convexDir, '_zodvex')
  fs.mkdirSync(zodvexDir, { recursive: true })

  const apiStub = `// Auto-generated stub. Run \`zodvex generate\` to populate.
export const zodvexRegistry = {} as const
`
  fs.writeFileSync(path.join(zodvexDir, 'api.ts'), apiStub)

  const clientStub = `// Auto-generated stub. Run \`zodvex generate\` to populate.
import { zodvexRegistry } from './api'

export const useZodQuery = undefined as any
export const useZodMutation = undefined as any
export const createClient = undefined as any
`
  fs.writeFileSync(path.join(zodvexDir, 'client.ts'), clientStub)
}

/**
 * Interactive init orchestrator — generates stubs and prints next steps.
 * Full interactive init will come in a future task.
 */
export async function init(): Promise<void> {
  const convexDir = path.resolve('convex')
  if (!fs.existsSync(convexDir)) {
    console.error('[zodvex] No convex/ directory found. Run this from your project root.')
    return
  }

  generateStubs(convexDir)
  console.log('[zodvex] Generated stub files in convex/_zodvex/')
  console.log('[zodvex] Run `zodvex generate` to populate with your models and functions.')
}
