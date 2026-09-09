import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, test } from 'vitest'

// Type-only cycles are harmless at module initialization. Keep static value
// imports and re-exports acyclic so schema construction does not depend on
// another module's partially initialized exports.
test('source runtime imports have no cycles', () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url))
  const files = readdirSync(root, { recursive: true })
    .filter(file => file.endsWith('.ts'))
    .map(file => path.join(root, file))
  const graph = new Map(files.map(file => [file, [] as string[]]))

  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest)
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
      const specifier = statement.moduleSpecifier
      if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) continue
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause
        if (clause?.isTypeOnly) continue
        if (
          clause &&
          !clause.name &&
          clause.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.length > 0 &&
          clause.namedBindings.elements.every(element => element.isTypeOnly)
        )
          continue
      } else {
        if (statement.isTypeOnly) continue
        const clause = statement.exportClause
        if (
          clause &&
          ts.isNamedExports(clause) &&
          clause.elements.length > 0 &&
          clause.elements.every(element => element.isTypeOnly)
        )
          continue
      }
      const base = path.resolve(path.dirname(file), specifier.text)
      const target = [`${base}.ts`, path.join(base, 'index.ts')].find(candidate =>
        graph.has(candidate)
      )
      if (target) graph.get(file)?.push(target)
    }
  }

  const visited = new Set<string>()
  const stack: string[] = []
  const cycles: string[] = []
  function visit(file: string) {
    const position = stack.indexOf(file)
    if (position !== -1) {
      cycles.push(
        [...stack.slice(position), file].map(item => path.relative(root, item)).join(' → ')
      )
      return
    }
    if (visited.has(file)) return
    visited.add(file)
    stack.push(file)
    for (const dependency of graph.get(file) ?? []) visit(dependency)
    stack.pop()
  }
  for (const file of files) visit(file)
  expect(cycles).toEqual([])
})
