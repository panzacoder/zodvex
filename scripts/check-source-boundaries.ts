import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const srcRoot = path.join(repoRoot, 'packages/zodvex/src')

type Rule = {
  appliesTo: (file: string) => boolean
  allowTarget: (target: string) => boolean
  message: string
}

const rules: Rule[] = [
  {
    appliesTo: file => file.includes('/packages/zodvex/src/internal/'),
    allowTarget: target => target.includes('/packages/zodvex/src/internal/'),
    message: 'internal modules must only import other internal modules'
  },
  {
    appliesTo: file => file.includes('/packages/zodvex/src/compat/'),
    allowTarget: target =>
      target.includes('/packages/zodvex/src/public/') ||
      target.endsWith('/packages/zodvex/src/index.ts'),
    message: 'compat modules must only re-export canonical public surfaces'
  },
  {
    appliesTo: file => file.includes('/packages/zodvex/src/core/'),
    allowTarget: target => target.endsWith('/packages/zodvex/src/index.ts'),
    message: 'core wrappers must only point at the canonical root public surface'
  },
  {
    appliesTo: file => file.includes('/packages/zodvex/src/public/'),
    allowTarget: target => !target.includes('/packages/zodvex/src/compat/'),
    message: 'public modules must not depend on compat wrappers'
  }
]

function collectTsFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      files.push(...collectTsFiles(full))
      continue
    }
    if (full.endsWith('.ts')) {
      files.push(full)
    }
  }
  return files
}

function resolveRelativeImport(file: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(file), specifier)
  const candidates = [
    base,
    `${base}.ts`,
    path.join(base, 'index.ts')
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return path.resolve(candidate)
    }
  }
  return null
}

function extractRelativeSpecifiers(source: string): string[] {
  const specifiers = new Set<string>()
  const patterns = [
    /\bimport\s+[^'"]*?\sfrom\s+['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"]*?\sfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
  ]

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) {
      const specifier = match[1]
      if (specifier.startsWith('.')) {
        specifiers.add(specifier)
      }
    }
  }

  return [...specifiers]
}

const violations: string[] = []

for (const file of collectTsFiles(srcRoot)) {
  const source = readFileSync(file, 'utf8')
  const specifiers = extractRelativeSpecifiers(source)

  for (const specifier of specifiers) {
    const resolved = resolveRelativeImport(file, specifier)
    if (!resolved) continue

    for (const rule of rules) {
      if (!rule.appliesTo(file)) continue
      if (rule.allowTarget(resolved)) continue
      violations.push(
        `${path.relative(repoRoot, file)} -> ${specifier} (${path.relative(repoRoot, resolved)}): ${rule.message}`
      )
    }
  }
}

if (violations.length > 0) {
  console.error('[zodvex] Source boundary violations found:\n')
  for (const violation of violations) {
    console.error(`  - ${violation}`)
  }
  process.exit(1)
}

console.log('[zodvex] Source boundaries OK')
