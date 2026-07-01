import {
  type ArrowFunction,
  type CallExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type Symbol as MorphSymbol,
  Node,
  type ParameterDeclaration
} from 'ts-morph'

export type TaintKind = 'ctx' | 'db'

/**
 * Set of symbols tainted as `ctx` or `db` in a given analysis scope.
 *
 * Symbols are resolved via ts-morph, so scoping is respected. A `db` variable
 * in one function does not automatically taint a same-named variable in another.
 */
export type TaintState = {
  ctxSymbols: Set<MorphSymbol>
  dbSymbols: Set<MorphSymbol>
}

export function createTaintState(): TaintState {
  return { ctxSymbols: new Set(), dbSymbols: new Set() }
}

export function cloneTaintState(state: TaintState): TaintState {
  return {
    ctxSymbols: new Set(state.ctxSymbols),
    dbSymbols: new Set(state.dbSymbols)
  }
}

/**
 * Seed taint from a handler's parameter list.
 *
 * Handles:
 *   (ctx, args) => ...              // taints `ctx` as ctx
 *   ({ db }, args) => ...           // taints `db` as db
 *   ({ db: d }, args) => ...        // taints `d` as db
 *   ({ db, ...rest }, args) => ...  // taints `db` as db, ignores rest
 *
 * Returns whether the first parameter could be understood. If false, the caller
 * should emit a diagnostic because the handler's ctx is not trackable.
 */
export function seedTaintFromHandler(
  handler: ArrowFunction | FunctionExpression | FunctionDeclaration,
  state: TaintState
): boolean {
  const params = handler.getParameters()
  if (params.length === 0) return false

  const ctxParam = params[0]
  if (!ctxParam) return false

  return addTaintFromParameter(ctxParam, 'ctx', state)
}

/**
 * Apply `kind` taint to a parameter, handling destructuring.
 */
export function addTaintFromParameter(
  param: ParameterDeclaration,
  kind: TaintKind,
  state: TaintState
): boolean {
  const nameNode = param.getNameNode()

  // Simple identifier parameter
  if (Node.isIdentifier(nameNode)) {
    const symbol = nameNode.getSymbol()
    if (!symbol) return false
    if (kind === 'ctx') state.ctxSymbols.add(symbol)
    else state.dbSymbols.add(symbol)
    return true
  }

  // Destructured parameter — `{ db }`, `{ db: rename }`, etc.
  if (Node.isObjectBindingPattern(nameNode) && kind === 'ctx') {
    // Only make sense to destructure a ctx parameter — we look for the `db` field.
    for (const element of nameNode.getElements()) {
      const propName = element.getPropertyNameNode()?.getText() ?? element.getName()
      if (propName !== 'db') continue

      const bindingName = element.getNameNode()
      if (Node.isIdentifier(bindingName)) {
        const symbol = bindingName.getSymbol()
        if (symbol) state.dbSymbols.add(symbol)
      }
    }
    return true
  }

  return false
}

/**
 * Check whether an expression refers to the tainted `db` object.
 *
 * Recognized forms:
 *   `db`             — Identifier whose symbol ∈ dbSymbols
 *   `ctx.db`         — PropertyAccess where ctx ∈ ctxSymbols and property name is "db"
 *   `alias.db`       — PropertyAccess where alias ∈ ctxSymbols and property name is "db"
 */
export function isDbReference(node: Node, state: TaintState): boolean {
  if (Node.isIdentifier(node)) {
    const symbol = node.getSymbol()
    if (!symbol) return false
    return state.dbSymbols.has(symbol)
  }

  if (Node.isPropertyAccessExpression(node)) {
    const prop = node.getNameNode().getText()
    if (prop !== 'db') return false
    const receiver = node.getExpression()
    if (!Node.isIdentifier(receiver)) return false
    const symbol = receiver.getSymbol()
    if (!symbol) return false
    return state.ctxSymbols.has(symbol)
  }

  return false
}

/**
 * Classify an argument passed to a function call for taint-propagation purposes.
 *
 * Returns the taint kind that should propagate through the corresponding parameter,
 * or null if the argument is not tainted.
 *
 * Recognized forms:
 *   `ctx`        — identifier for tainted ctx → propagates 'ctx'
 *   `db`         — identifier for tainted db  → propagates 'db'
 *   `ctx.db`     — property access, ctx tainted, prop is "db" → propagates 'db'
 */
export function classifyArgument(node: Node, state: TaintState): TaintKind | null {
  if (Node.isIdentifier(node)) {
    const symbol = node.getSymbol()
    if (!symbol) return null
    if (state.ctxSymbols.has(symbol)) return 'ctx'
    if (state.dbSymbols.has(symbol)) return 'db'
    return null
  }

  if (Node.isPropertyAccessExpression(node)) {
    if (isDbReference(node, state)) return 'db'
    return null
  }

  return null
}

/**
 * Process a variable declaration that might introduce a tainted alias.
 *
 * Handles:
 *   const x = ctx                    // x tainted as ctx
 *   const x = ctx.db                 // x tainted as db
 *   const x = db                     // x tainted as db
 *   const { db } = ctx               // db (the new symbol) tainted as db
 *   const { db: y } = ctx            // y tainted as db
 *   const x = db.withRules(...)      // x tainted as db (wrapper pattern)
 *   const x = ctx.db.withRules(...)  // x tainted as db (wrapper pattern)
 *   const [a] = ctx.db               // ignored (array destructure of db makes no sense)
 */
export function processVariableDeclaration(
  declNode: Node,
  state: TaintState,
  isDbMethod: (methodName: string) => boolean
): void {
  if (!Node.isVariableDeclaration(declNode)) return

  const init = declNode.getInitializer()
  if (!init) return

  const nameNode = declNode.getNameNode()

  // Simple name: `const x = expr`
  if (Node.isIdentifier(nameNode)) {
    const targetSymbol = nameNode.getSymbol()
    if (!targetSymbol) return

    const kind = classifyArgument(init, state)
    if (kind === 'ctx') {
      state.ctxSymbols.add(targetSymbol)
      return
    }
    if (kind === 'db') {
      state.dbSymbols.add(targetSymbol)
      return
    }

    // Wrapper pattern: `const x = db.someWrapper(...)` where someWrapper is NOT a known
    // db read/write method. Wrapper calls return a db-like object (e.g. `withRules`,
    // `withAuth`, `withIndex`-on-db-not-query). We don't know all possible wrapper names,
    // so we taint anything that isn't a known data-method call.
    const wrapperTaint = classifyWrapperCall(init, state, isDbMethod)
    if (wrapperTaint) state.dbSymbols.add(targetSymbol)
    return
  }

  // Object destructuring: `const { db } = ctx` or `const { db: alias } = ctx`
  if (Node.isObjectBindingPattern(nameNode)) {
    const initKind = classifyArgument(init, state)
    if (initKind !== 'ctx') return // only destructuring ctx yields a db taint

    for (const element of nameNode.getElements()) {
      const propName = element.getPropertyNameNode()?.getText() ?? element.getName()
      if (propName !== 'db') continue

      const bindingName = element.getNameNode()
      if (Node.isIdentifier(bindingName)) {
        const symbol = bindingName.getSymbol()
        if (symbol) state.dbSymbols.add(symbol)
      }
    }
  }
}

/**
 * If a call expression is a method call on a tainted db using a method we don't
 * recognize as a data operation, assume it's a db-wrapping method (e.g. withRules)
 * that returns a db-like object. Returns true if so.
 */
function classifyWrapperCall(
  node: Node,
  state: TaintState,
  isDbMethod: (methodName: string) => boolean
): boolean {
  if (!Node.isCallExpression(node)) return false

  const expr = node.getExpression()
  if (!Node.isPropertyAccessExpression(expr)) return false

  const receiver = expr.getExpression()
  if (!isDbReference(receiver, state)) return false

  const methodName = expr.getNameNode().getText()
  // If the method IS a known data method (query, insert, etc.), its return value is data
  // or a QueryInitializer — not another db. Don't taint.
  if (isDbMethod(methodName)) return false

  // Unknown method on a tainted db → assume db-wrapping pattern, taint the result.
  return true
}

/**
 * Find all variable declarations within a function body and process them for taint.
 * This is typically called once at the start of analyzing a function body, before
 * walking for db calls, so that taint aliases are ready when we encounter uses.
 *
 * Note: this is flow-insensitive. We assume aliases remain valid throughout the
 * function body, which is almost always true in Convex handler code.
 */
export function processBodyDeclarations(
  body: Node,
  state: TaintState,
  isDbMethod: (methodName: string) => boolean
): void {
  body.forEachDescendant((node) => {
    if (Node.isVariableDeclaration(node)) {
      processVariableDeclaration(node, state, isDbMethod)
    }
  })
}

/**
 * Get all call expressions in a function body.
 */
export function getCallExpressions(body: Node): CallExpression[] {
  const calls: CallExpression[] = []
  // An expression-bodied arrow (`=> ctx.db.get(id)`) has the call AS the body,
  // and forEachDescendant never visits the node itself.
  if (Node.isCallExpression(body)) calls.push(body)
  body.forEachDescendant((node) => {
    if (Node.isCallExpression(node)) calls.push(node)
  })
  return calls
}
