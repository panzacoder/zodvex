import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { sha256 } from '../memory/provenance.mjs'
const ts = createRequire(import.meta.url)('typescript')

export function auditBundle(debugDirectory, outputDirectory, fixture) {
  const config = JSON.parse(readFileSync(path.join(debugDirectory, 'fullConfig.json'), 'utf8'))
  const modules = new Map(config.modules.map(module => [module.path, module]))
  const manifest = {}
  mkdirSync(outputDirectory, { recursive: true })
  for (const [name, module] of modules) {
    if (module.environment !== 'isolate') throw new Error('Expected V8 isolate modules only')
    const imports = { static: [], dynamic: [] }
    const source = ts.createSourceFile(name, module.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const add = (kind, specifier) => {
      if (!specifier.startsWith('.')) throw new Error(`Unbundled import in ${name}`)
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier))
      if (!modules.has(target)) throw new Error(`Unresolved emitted module ${target}`)
      imports[kind].push(target)
    }
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
        add('static', node.moduleSpecifier.text)
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (!ts.isStringLiteral(node.arguments[0])) throw new Error('Nonliteral emitted dynamic target')
        add('dynamic', node.arguments[0].text)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    const sourceInputs = module.sourceMap ? JSON.parse(module.sourceMap).sources : []
    manifest[name] = { sha256: sha256(module.source), bytes: Buffer.byteLength(module.source),
      imports, sourceInputs,
      modelInitMarkers: [...module.source.matchAll(/["']model-init:(model\d{3})["']/g)].map(match => match[1]),
    }
    const file = path.join(outputDirectory, name)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, module.source)
  }
  const closure = (root, dynamic = false) => {
    const seen = new Set()
    const visit = name => {
      if (seen.has(name)) return
      seen.add(name)
      for (const target of manifest[name].imports.static) visit(target)
      if (dynamic) for (const target of manifest[name].imports.dynamic) visit(target)
    }
    visit(root)
    return [...seen].sort()
  }
  const endpoints = {}
  for (const kind of ['static', 'dynamic', 'helpers']) {
    const reachable = closure(`${kind}.js`)
    endpoints[kind] = {
      staticModules: reachable,
      staticBytes: reachable.reduce((sum, name) => sum + manifest[name].bytes, 0),
      initializedModelMarkers: [...new Set(reachable.flatMap(name => manifest[name].modelInitMarkers))].sort(),
      dynamicTargets: [...new Set(reachable.flatMap(name => manifest[name].imports.dynamic))].sort(),
      allReachableBytes: closure(`${kind}.js`, true).reduce((sum, name) => sum + manifest[name].bytes, 0),
    }
  }
  const checks = {
    staticLoadsEveryModel: JSON.stringify(endpoints.static.initializedModelMarkers) === JSON.stringify(fixture.names),
    dynamicInitiallyLoadsNoModel: endpoints.dynamic.initializedModelMarkers.length === 0,
    dynamicTargetsAreSeparateModules: endpoints.dynamic.dynamicTargets.length === fixture.total &&
      endpoints.dynamic.dynamicTargets.every(name => !endpoints.dynamic.staticModules.includes(name)),
    dynamicCanReachEveryModel: JSON.stringify([...new Set(closure('dynamic.js', true)
      .flatMap(name => manifest[name].modelInitMarkers))].sort()) === JSON.stringify(fixture.names),
    helperLoadsNoZodvexModels: endpoints.helpers.initializedModelMarkers.length === 0,
    helperHasNoZodvexDependency: endpoints.helpers.staticModules.every(name =>
      manifest[name].sourceInputs.every(input => !/(?:^|\/)zodvex\/(?:dist|src)\//.test(input))),
    helperUsesActualBuilder: endpoints.helpers.staticModules.some(name =>
      manifest[name].sourceInputs.some(input => input.endsWith('/convex-helpers/server/zod4.js'))),
  }
  const result = { format: 'zodvex-dynamic-import-bundle-v1', udfServerVersion: config.udfServerVersion,
    moduleSetHash: sha256(JSON.stringify(Object.entries(manifest).map(([name, row]) => [name, row.sha256]).sort())),
    modules: manifest, endpoints, checks }
  writeFileSync(path.join(outputDirectory, '../bundle-audit.json'), JSON.stringify(result, null, 2))
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name)
  if (failed.length) throw new Error(`Emitted bundle audit failed: ${failed.join(', ')}`)
  return result
}
