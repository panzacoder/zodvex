import type { FunctionInfo, TableGraphLike } from './types'

/**
 * Given a mutation path, return every public query path in the graph that
 * reads a table the mutation writes. Internal queries are excluded because
 * clients can't subscribe to them.
 */
export function findAffectedQueryPaths(graph: TableGraphLike, mutationPath: string): string[] {
  const mutation = graph.functions[mutationPath]
  if (!mutation) return []
  if (mutation.kind !== 'mutation' && mutation.kind !== 'internalMutation') return []
  if (mutation.writes.length === 0) return []

  const writtenTables = new Set(mutation.writes)
  const affected: string[] = []

  for (const [path, info] of Object.entries(graph.functions)) {
    if (!isClientSubscribable(info)) continue
    for (const read of info.reads) {
      if (writtenTables.has(read)) {
        affected.push(path)
        break
      }
    }
  }

  return affected.sort()
}

function isClientSubscribable(info: FunctionInfo): boolean {
  return info.kind === 'query' && info.visibility === 'public'
}

/**
 * Determine where a newly inserted doc lands in a query's results, from the
 * graph's statically extracted orderings.
 *
 * Only creation-time orderings are placeable (new docs always have the max
 * `_creationTime`): desc → 'start', asc → 'end'. When the mutation writes
 * several tables the query reads, every such table must have a placeable
 * ordering and they must all agree — the prediction doesn't say which table
 * the doc belongs to.
 *
 * Returns undefined when placement can't be derived; callers fall back to
 * the prediction's explicit `at` hint.
 */
export function resolveInsertPlacement(
  graph: TableGraphLike,
  mutationPath: string,
  queryPath: string
): 'start' | 'end' | undefined {
  const mutation = graph.functions[mutationPath]
  const query = graph.functions[queryPath]
  if (!mutation || !query?.resultOrderings) return undefined

  const written = new Set(mutation.writes)
  const relevantTables = query.reads.filter((t) => written.has(t))
  if (relevantTables.length === 0) return undefined

  let placement: 'start' | 'end' | undefined
  for (const table of relevantTables) {
    const ordering = query.resultOrderings.find((o) => o.table === table)
    if (!ordering || !ordering.byCreationTime) return undefined
    const p = ordering.direction === 'desc' ? 'start' : 'end'
    if (placement && placement !== p) return undefined
    placement = p
  }
  return placement
}

/**
 * Walk a Convex `api` object and resolve a function path (e.g. "tasks:list"
 * or "api/reports:summary") to its FunctionReference.
 *
 * Returns null if the path is malformed or doesn't resolve to a reference
 * in the provided api root.
 */
export function resolveRefFromPath(apiRoot: unknown, functionPath: string): unknown {
  const colon = functionPath.lastIndexOf(':')
  if (colon === -1) return null

  const modulePart = functionPath.slice(0, colon)
  const exportPart = functionPath.slice(colon + 1)

  const segments = modulePart.split('/').filter(Boolean)
  if (segments.length === 0) return null

  let node: unknown = apiRoot
  for (const segment of segments) {
    if (!isIndexable(node)) return null
    node = (node as Record<string, unknown>)[segment]
  }

  if (!isIndexable(node)) return null
  const ref = (node as Record<string, unknown>)[exportPart]
  return ref ?? null
}

function isIndexable(value: unknown): boolean {
  return value !== null && typeof value === 'object'
}

/**
 * Resolve all query paths affected by a mutation into an array of
 * (path, ref) entries. Entries where the ref can't be resolved from the api
 * object are dropped and reported as diagnostics.
 */
export function resolveAffectedQueries(
  graph: TableGraphLike,
  apiRoot: unknown,
  mutationPath: string
): { resolved: Array<{ path: string; ref: unknown }>; unresolved: string[] } {
  const paths = findAffectedQueryPaths(graph, mutationPath)
  const resolved: Array<{ path: string; ref: unknown }> = []
  const unresolved: string[] = []

  for (const path of paths) {
    const ref = resolveRefFromPath(apiRoot, path)
    if (ref == null) unresolved.push(path)
    else resolved.push({ path, ref })
  }

  return { resolved, unresolved }
}
