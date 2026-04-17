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
 * Names of branded properties used by Convex Id types to carry the table literal.
 *
 * `__tableName` is the standard in Convex's open-source runtime. Others are
 * permissive fallbacks for custom/branded Id aliases in user code.
 */
const TABLE_BRAND_PROPS = ['__tableName', '_tableName', 'tableName', '__table']

/**
 * Extract the table-name type argument from an `Id<"tableName">` type.
 *
 * Tries three strategies in order:
 *   1. Alias-preserved generic form — `Id<"tasks">` with getAliasTypeArguments()
 *   2. Direct type-argument form — rare after type expansion
 *   3. Expanded intersection form — `string & { __tableName: "tasks" }`
 *
 * Returns null if no strategy yields a string-literal table name.
 */
export function extractTableFromIdType(type: Type): string | null {
  const fromAlias = tryFromAliasArguments(type)
  if (fromAlias) return fromAlias

  const fromArgs = tryFromTypeArguments(type)
  if (fromArgs) return fromArgs

  return tryFromBrandProperty(type)
}

function tryFromAliasArguments(type: Type): string | null {
  const aliasArgs = type.getAliasTypeArguments()
  if (aliasArgs.length === 0) return null
  return literalFromType(aliasArgs[0]!)
}

function tryFromTypeArguments(type: Type): string | null {
  const typeArgs = type.getTypeArguments()
  if (typeArgs.length === 0) return null
  return literalFromType(typeArgs[0]!)
}

/**
 * Recognize the expanded Convex Id shape: `string & { __tableName: "tasks" }`.
 *
 * When TypeScript expands `Id<"tasks">` away from its alias, the underlying
 * intersection survives. We walk it to find a property whose type is a
 * string-literal — that's the table name.
 */
function tryFromBrandProperty(type: Type): string | null {
  const candidates: Type[] = []
  if (type.isIntersection()) {
    candidates.push(...type.getIntersectionTypes())
  } else {
    candidates.push(type)
  }

  for (const candidate of candidates) {
    for (const propName of TABLE_BRAND_PROPS) {
      const prop = candidate.getProperty(propName)
      if (!prop) continue
      const declarations = prop.getDeclarations()
      if (declarations.length === 0) continue
      const propType = prop.getTypeAtLocation(declarations[0]!)
      const literal = literalFromType(propType)
      if (literal) return literal
    }
  }

  return null
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
