import {
  Node,
  type ArrowFunction,
  type CallExpression,
  type Expression,
  type FunctionDeclaration,
  type FunctionExpression,
  type Type
} from 'ts-morph'

export type CallableDeclaration = FunctionDeclaration | ArrowFunction | FunctionExpression

/**
 * Resolve the callee of a call expression to a function declaration we can analyze.
 *
 * Handles:
 *   foo(...)              — direct Identifier reference
 *   mod.foo(...)          — property-access (e.g. namespace import)
 *   foo.bar(...)          — method call on a namespace/object
 *
 * Follows aliases and re-exports. Returns null if the callee cannot be resolved to
 * an analyzable local function declaration (external packages, dynamic dispatch,
 * etc.).
 */
export function resolveCallee(call: CallExpression): CallableDeclaration | null {
  const expr = call.getExpression()

  let identifier: Node | null = null
  if (Node.isIdentifier(expr)) {
    identifier = expr
  } else if (Node.isPropertyAccessExpression(expr)) {
    identifier = expr.getNameNode()
  }

  if (!identifier || !Node.isIdentifier(identifier)) return null

  let symbol = identifier.getSymbol()
  if (!symbol) return null

  // Follow aliases (e.g. `import { foo } from './helpers'` → actual export)
  const aliased = symbol.getAliasedSymbol()
  if (aliased) symbol = aliased

  const declarations = symbol.getDeclarations()
  for (const decl of declarations) {
    // `export function foo() { ... }` or `function foo() { ... }`
    if (Node.isFunctionDeclaration(decl)) {
      return decl
    }

    // `export const foo = (a, b) => { ... }`
    // `const foo = function(a, b) { ... }`
    if (Node.isVariableDeclaration(decl)) {
      const init = decl.getInitializer()
      if (!init) continue
      if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
        return init
      }
    }
  }

  return null
}

/**
 * Attempt to resolve a string-literal value from an expression.
 *
 * Handles:
 *   "tasks"           — direct string literal
 *   `tasks`           — no-substitution template literal
 *   TABLE_NAME        — const binding to a string literal
 *
 * Returns null if the value cannot be statically determined.
 */
export function resolveStringLiteral(expr: Expression | Node): string | null {
  if (Node.isStringLiteral(expr)) return expr.getLiteralValue()

  if (Node.isNoSubstitutionTemplateLiteral(expr)) return expr.getLiteralValue()

  if (Node.isIdentifier(expr)) {
    const symbol = expr.getSymbol()
    if (!symbol) return null
    const declarations = symbol.getDeclarations()
    for (const decl of declarations) {
      if (Node.isVariableDeclaration(decl)) {
        const init = decl.getInitializer()
        if (!init) continue
        if (Node.isStringLiteral(init)) return init.getLiteralValue()
        if (Node.isNoSubstitutionTemplateLiteral(init)) return init.getLiteralValue()
      }
    }
  }

  return null
}

/**
 * Extract the table-name type argument from an `Id<"tableName">` type.
 *
 * Returns null if the type is not an Id, the argument is not a string literal type,
 * or the type cannot be resolved.
 */
export function extractTableFromIdType(type: Type): string | null {
  // Look for Id<"tableName"> structure. The type may be a reference alias.
  const symbol = type.getSymbol() ?? type.getAliasSymbol()
  if (!symbol) return tryFromTypeArguments(type)

  const name = symbol.getName()
  // Convex Id type has name "GenericId" (internally) or "Id" (aliased)
  if (name !== 'Id' && name !== 'GenericId') {
    return tryFromTypeArguments(type)
  }

  return tryFromTypeArguments(type)
}

function tryFromTypeArguments(type: Type): string | null {
  const typeArgs = type.getTypeArguments()
  if (typeArgs.length === 0) {
    const aliasArgs = type.getAliasTypeArguments()
    if (aliasArgs.length === 0) return null
    return literalFromType(aliasArgs[0]!)
  }

  return literalFromType(typeArgs[0]!)
}

function literalFromType(type: Type): string | null {
  if (type.isStringLiteral()) {
    const literal = type.getLiteralValue()
    if (typeof literal === 'string') return literal
  }
  return null
}

/**
 * Get the type of a call argument at a specific index, if present.
 */
export function getArgumentType(call: CallExpression, index: number): Type | null {
  const args = call.getArguments()
  const arg = args[index]
  if (!arg || !Node.isNode(arg)) return null
  return (arg as Expression).getType()
}
