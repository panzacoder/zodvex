/**
 * Result-ordering extraction: given the `db.query('table')` call that starts a
 * query chain, walk UP the method chain and classify how the results will be
 * ordered. Extraction is deliberately conservative — anything we can't fully
 * see (broken chains, dynamic arguments, unknown methods) is inconclusive, and
 * an inconclusive chain invalidates the table's ordering for the function.
 */

import { type CallExpression, Node } from 'ts-morph'

export type ChainOrdering =
  /** Complete list-producing chain with a statically known ordering. */
  | { kind: 'ordering'; direction: 'asc' | 'desc'; byCreationTime: boolean }
  /** Complete chain, but produces a single doc (first/unique) — ordering N/A. */
  | { kind: 'single' }
  /** Chain broken, dynamic, or uses methods we don't understand. */
  | { kind: 'inconclusive' }

/** Terminators that produce ordered lists. */
const LIST_TERMINATORS = new Set(['collect', 'take', 'paginate'])
/** Terminators that produce a single document. */
const SINGLE_TERMINATORS = new Set(['first', 'unique'])
/** Chain methods that preserve ordering and can be skipped. */
const ORDER_PRESERVING = new Set(['filter'])

/** Convex's built-in creation-time index name. */
const CREATION_TIME_INDEX = 'by_creation_time'

/**
 * Walk up from a `db.query('t')` call through `.method(...)` links until a
 * terminator is reached or the chain breaks (assignment, argument position,
 * ternary, etc.).
 */
export function extractChainOrdering(queryCall: CallExpression): ChainOrdering {
  let direction: 'asc' | 'desc' | null = null
  let indexName: string | null = null

  let node: Node = queryCall
  for (;;) {
    const parent = node.getParent()

    // Chain link shape: <node>.method(...) — a PropertyAccessExpression whose
    // expression is `node`, itself the callee of a CallExpression.
    if (!parent || !Node.isPropertyAccessExpression(parent) || parent.getExpression() !== node) {
      return { kind: 'inconclusive' }
    }
    const callNode = parent.getParent()
    if (!callNode || !Node.isCallExpression(callNode) || callNode.getExpression() !== parent) {
      return { kind: 'inconclusive' }
    }

    const method = parent.getNameNode().getText()

    if (LIST_TERMINATORS.has(method)) {
      return {
        kind: 'ordering',
        direction: direction ?? 'asc',
        byCreationTime: indexName === null || indexName === CREATION_TIME_INDEX
      }
    }
    if (SINGLE_TERMINATORS.has(method)) {
      return { kind: 'single' }
    }

    if (method === 'order') {
      const literal = stringLiteralArg(callNode, 0)
      if (literal !== 'asc' && literal !== 'desc') return { kind: 'inconclusive' }
      direction = literal
    } else if (method === 'withIndex') {
      const literal = stringLiteralArg(callNode, 0)
      if (literal === null) return { kind: 'inconclusive' }
      indexName = literal
    } else if (method === 'withSearchIndex') {
      // Relevance-ordered — no placement semantics.
      return { kind: 'inconclusive' }
    } else if (!ORDER_PRESERVING.has(method)) {
      // Unknown chain method — could reorder or wrap; bail out.
      return { kind: 'inconclusive' }
    }

    node = callNode
  }
}

function stringLiteralArg(call: CallExpression, index: number): string | null {
  const arg = call.getArguments()[index]
  if (!arg) return null
  if (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.getLiteralText()
  }
  return null
}
