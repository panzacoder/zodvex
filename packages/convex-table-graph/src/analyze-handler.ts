import {
  Node,
  type ArrowFunction,
  type CallExpression,
  type FunctionDeclaration,
  type FunctionExpression
} from 'ts-morph'
import { DB_METHODS, DB_METHODS_IGNORED } from './db-methods'

const isDbMethod = (methodName: string): boolean => {
  return methodName in DB_METHODS || DB_METHODS_IGNORED.has(methodName)
}
import { type CallableDeclaration, extractTableFromIdType, getArgumentType, resolveCallee, resolveStringLiteral } from './resolve'
import {
  addTaintFromParameter,
  classifyArgument,
  cloneTaintState,
  createTaintState,
  getCallExpressions,
  isDbReference,
  processBodyDeclarations,
  seedTaintFromHandler,
  type TaintState
} from './taint'
import type { Diagnostic } from './types'

export type AnalysisResult = {
  reads: Set<string>
  writes: Set<string>
  partial: boolean
  diagnostics: Diagnostic[]
}

export type AnalyzeContext = {
  maxDepth: number
  /** Cycle detection — don't re-analyze a function we've already entered */
  visited: Set<CallableDeclaration>
  functionPath: string
}

/**
 * Analyze a Convex handler function body for table reads and writes.
 *
 * Walks the body, extracts direct ctx.db calls, and follows calls that propagate
 * the ctx or db object to bounded depth. Emits diagnostics for anything unresolved.
 */
export function analyzeHandler(
  handler: ArrowFunction | FunctionExpression | FunctionDeclaration,
  ctx: AnalyzeContext
): AnalysisResult {
  const result: AnalysisResult = {
    reads: new Set(),
    writes: new Set(),
    partial: false,
    diagnostics: []
  }

  const state = createTaintState()
  const seeded = seedTaintFromHandler(handler, state)
  if (!seeded) {
    result.partial = true
    result.diagnostics.push(makeDiagnostic(handler, ctx.functionPath, 'Could not seed taint from handler parameters'))
    return result
  }

  analyzeFunctionBody(handler, state, 0, ctx, result)
  return result
}

/**
 * Recursive worker: analyze a function body with a given taint state.
 */
function analyzeFunctionBody(
  fn: CallableDeclaration,
  state: TaintState,
  depth: number,
  ctx: AnalyzeContext,
  result: AnalysisResult
): void {
  if (ctx.visited.has(fn)) return
  ctx.visited.add(fn)

  const body = getFunctionBody(fn)
  if (!body) return

  processBodyDeclarations(body, state, isDbMethod)

  const calls = getCallExpressions(body)

  for (const call of calls) {
    // 1. Is this a direct call on a tainted db? If so, record the table.
    const dbCall = tryExtractDbCall(call, state)
    if (dbCall) {
      if (dbCall.op === 'read') result.reads.add(dbCall.table)
      else result.writes.add(dbCall.table)
      continue
    }

    const unresolvedDb = tryExtractUnresolvedDbCall(call, state)
    if (unresolvedDb) {
      result.partial = true
      result.diagnostics.push(
        makeDiagnosticAt(
          call,
          ctx.functionPath,
          `Could not resolve ${unresolvedDb} argument for ${unresolvedDb} call`,
          'unresolved-db-arg'
        )
      )
      continue
    }

    // 2. Does this call pass tainted args to another function? Follow it.
    const propagation = getTaintPropagation(call, state)
    if (propagation.length === 0) continue

    if (depth + 1 > ctx.maxDepth) {
      result.partial = true
      result.diagnostics.push(
        makeDiagnosticAt(
          call,
          ctx.functionPath,
          `Max call-graph depth (${ctx.maxDepth}) reached — skipping analysis of deeper calls`,
          'max-depth'
        )
      )
      continue
    }

    const callee = resolveCallee(call)
    if (!callee) {
      result.partial = true
      result.diagnostics.push(
        makeDiagnosticAt(
          call,
          ctx.functionPath,
          `Could not resolve callee receiving tainted argument`,
          'unresolvable-callee'
        )
      )
      continue
    }

    // Propagate taint into the callee's scope.
    const childState = createTaintState()
    for (const { paramIndex, kind } of propagation) {
      const params = callee.getParameters()
      const param = params[paramIndex]
      if (!param) {
        result.partial = true
        result.diagnostics.push(
          makeDiagnosticAt(
            call,
            ctx.functionPath,
            `Call passes tainted argument at index ${paramIndex}, but callee has only ${params.length} parameters`,
            'param-mismatch'
          )
        )
        continue
      }
      addTaintFromParameter(param, kind, childState)
    }

    analyzeFunctionBody(callee, childState, depth + 1, ctx, result)
  }
}

type DbCallInfo = { op: 'read' | 'write'; table: string }

/**
 * Try to interpret a call as a direct ctx.db method call on a tainted db reference,
 * and extract the table name.
 *
 * Returns null if:
 *   - The call is not on a tainted db reference
 *   - The method is one we don't track (normalizeId, system)
 *   - The table name could not be resolved (caller should emit diagnostic separately)
 */
function tryExtractDbCall(call: CallExpression, state: TaintState): DbCallInfo | null {
  const expr = call.getExpression()
  if (!Node.isPropertyAccessExpression(expr)) return null

  const receiver = expr.getExpression()
  if (!isDbReference(receiver, state)) return null

  const methodName = expr.getNameNode().getText()
  if (DB_METHODS_IGNORED.has(methodName)) return null

  const spec = DB_METHODS[methodName]
  if (!spec) return null

  const table = extractTableName(call, spec.argIndex, spec.tableSource)
  if (!table) return null

  return { op: spec.op, table }
}

/**
 * If a call is a db method on a tainted reference but we couldn't resolve the
 * table name, return the method name so we can surface a diagnostic.
 */
function tryExtractUnresolvedDbCall(call: CallExpression, state: TaintState): string | null {
  const expr = call.getExpression()
  if (!Node.isPropertyAccessExpression(expr)) return null

  const receiver = expr.getExpression()
  if (!isDbReference(receiver, state)) return null

  const methodName = expr.getNameNode().getText()
  if (DB_METHODS_IGNORED.has(methodName)) return null

  const spec = DB_METHODS[methodName]
  if (!spec) return null

  const table = extractTableName(call, spec.argIndex, spec.tableSource)
  if (!table) return methodName

  return null
}

function extractTableName(
  call: CallExpression,
  argIndex: number,
  source: 'string' | 'idType'
): string | null {
  if (source === 'string') {
    const args = call.getArguments()
    const arg = args[argIndex]
    if (!arg) return null
    return resolveStringLiteral(arg as Node)
  }

  // idType: inspect the TypeScript type of the argument for Id<"table">
  const type = getArgumentType(call, argIndex)
  if (!type) return null
  return extractTableFromIdType(type)
}

type PropagationEntry = { paramIndex: number; kind: 'ctx' | 'db' }

/**
 * For a call that is NOT a db method call, determine which arguments (if any) are
 * tainted and what kind of taint they should carry into the callee.
 *
 * Returns an array of (paramIndex, kind) entries, one per tainted argument.
 */
function getTaintPropagation(call: CallExpression, state: TaintState): PropagationEntry[] {
  // Skip calls whose receiver is tainted db (those are already handled as db calls,
  // or are method chains on QueryInitializer which we don't need to recurse into).
  const expr = call.getExpression()
  if (Node.isPropertyAccessExpression(expr)) {
    if (isDbReference(expr.getExpression(), state)) return []
  }

  const result: PropagationEntry[] = []
  const args = call.getArguments()
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg || !Node.isNode(arg)) continue
    const kind = classifyArgument(arg as Node, state)
    if (kind) result.push({ paramIndex: i, kind })
  }
  return result
}

function getFunctionBody(
  fn: CallableDeclaration
): Node | null {
  if (Node.isFunctionDeclaration(fn)) {
    return fn.getBody() ?? null
  }
  if (Node.isArrowFunction(fn)) {
    return fn.getBody()
  }
  if (Node.isFunctionExpression(fn)) {
    return fn.getBody() ?? null
  }
  return null
}

function makeDiagnostic(node: Node, functionPath: string, message: string, code?: string): Diagnostic {
  return makeDiagnosticAt(node, functionPath, message, code)
}

function makeDiagnosticAt(
  node: Node,
  functionPath: string,
  message: string,
  code?: string
): Diagnostic {
  const sf = node.getSourceFile()
  const { line, column } = sf.getLineAndColumnAtPos(node.getStart())
  return {
    severity: 'warning',
    function: functionPath,
    file: sf.getFilePath(),
    line,
    column,
    message,
    code
  }
}
