import {
  type ArrowFunction,
  type CallExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type Identifier,
  Node,
  type SourceFile
} from 'ts-morph'
import type { BuilderConfig, FunctionKind, Visibility } from './types'

export type HandlerFunction = ArrowFunction | FunctionExpression | FunctionDeclaration

export type IdentifiedFunction = {
  /** Export name — "default" for default exports */
  exportName: string
  kind: FunctionKind
  visibility: Visibility
  /** The handler function node we should walk for db access */
  handler: HandlerFunction
  /** The builder call expression (for location reporting) */
  builderCall: CallExpression
  /** Name of the builder identifier (e.g. "query", "zMutation") */
  builderName: string
}

const KIND_TO_VISIBILITY: Record<FunctionKind, Visibility> = {
  query: 'public',
  mutation: 'public',
  action: 'public',
  internalQuery: 'internal',
  internalMutation: 'internal',
  internalAction: 'internal',
  httpAction: 'public'
}

/**
 * Build a lookup map from builder-identifier name to function kind.
 */
export function buildBuilderLookup(builders: BuilderConfig): Map<string, FunctionKind> {
  const lookup = new Map<string, FunctionKind>()
  for (const [kind, names] of Object.entries(builders) as [FunctionKind, string[]][]) {
    for (const name of names) lookup.set(name, kind)
  }
  return lookup
}

/**
 * Identify all Convex function exports in a source file.
 */
export function identifyFunctions(
  sourceFile: SourceFile,
  builders: BuilderConfig
): IdentifiedFunction[] {
  const lookup = buildBuilderLookup(builders)
  const results: IdentifiedFunction[] = []

  // Named exports: `export const name = query({ ... })` or `export const name = builder({ ... })`
  for (const declaration of sourceFile.getVariableDeclarations()) {
    if (!declaration.isExported()) continue

    const initializer = declaration.getInitializer()
    if (!initializer || !Node.isCallExpression(initializer)) continue

    const identified = identifyFromCall(initializer, lookup)
    if (identified) {
      results.push({
        exportName: declaration.getName(),
        ...identified
      })
    }
  }

  // Default export: `export default query({ ... })`
  const defaultExportSymbol = sourceFile.getDefaultExportSymbol()
  if (defaultExportSymbol) {
    const declarations = defaultExportSymbol.getDeclarations()
    for (const decl of declarations) {
      if (Node.isExportAssignment(decl)) {
        const expr = decl.getExpression()
        if (Node.isCallExpression(expr)) {
          const identified = identifyFromCall(expr, lookup)
          if (identified) {
            results.push({
              exportName: 'default',
              ...identified
            })
          }
        }
      }
    }
  }

  return results
}

/**
 * Given a call expression, determine whether it's a recognized Convex function builder
 * and extract the handler function from its argument.
 */
function identifyFromCall(
  call: CallExpression,
  lookup: Map<string, FunctionKind>
): Omit<IdentifiedFunction, 'exportName'> | null {
  const callee = call.getExpression()
  if (!Node.isIdentifier(callee)) return null

  const name = (callee as Identifier).getText()
  const kind = lookup.get(name)
  if (!kind) return null

  const handler = extractHandler(call)
  if (!handler) return null

  return {
    kind,
    visibility: KIND_TO_VISIBILITY[kind],
    handler,
    builderCall: call,
    builderName: name
  }
}

/**
 * Extract the handler function from a Convex builder's call arguments.
 *
 * Supports two shapes:
 *   query({ args: {...}, handler: async (ctx, args) => {...} })
 *   query(async (ctx, args) => {...})  // handler-only shorthand
 *
 * Note: the shorthand form `query(handler)` is used when there are no args schemas.
 */
export function extractHandler(call: CallExpression): HandlerFunction | null {
  const args = call.getArguments()
  if (args.length === 0) return null

  const first = args[0]
  if (!first) return null

  // Shape 1: object with `handler` property
  if (Node.isObjectLiteralExpression(first)) {
    const handlerProp = first.getProperty('handler')
    if (!handlerProp) return null

    // `handler: async (ctx, args) => { ... }` — PropertyAssignment with initializer
    if (Node.isPropertyAssignment(handlerProp)) {
      const init = handlerProp.getInitializer()
      if (!init) return null
      if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) return init
      return null
    }

    // `handler(ctx, args) { ... }` — MethodDeclaration/ShorthandMethod is uncommon but possible
    if (Node.isMethodDeclaration(handlerProp)) {
      // MethodDeclaration isn't one of our handler node types; skip for now.
      // This pattern is extremely rare in real Convex code.
      return null
    }

    return null
  }

  // Shape 2: function passed directly
  if (Node.isArrowFunction(first) || Node.isFunctionExpression(first)) {
    return first
  }

  return null
}

/**
 * Get the source location of a node for diagnostic reporting.
 */
export function getNodeLocation(node: Node): { line: number; column: number } {
  const sf = node.getSourceFile()
  const pos = node.getStart()
  const { line, column } = sf.getLineAndColumnAtPos(pos)
  return { line, column }
}
