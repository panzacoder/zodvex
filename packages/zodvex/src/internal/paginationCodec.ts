import type { FunctionReference } from 'convex/server'
import { createBoundaryHelpers, resolveFunctionPath } from './boundaryHelpers'
import type { AnyRegistry } from './types'
import { $ZodArray, $ZodObject, clone } from './zod-core'

/** Aggregate pagination only exposes items, not the original page envelopes. */
export function createPaginationCodec(registry: AnyRegistry) {
  const argsRegistry: AnyRegistry = Object.create(null)
  const resultsRegistry: AnyRegistry = Object.create(null)
  const argsCodec = createBoundaryHelpers(argsRegistry, { onDecodeError: 'throw' })
  const resultsCodec = createBoundaryHelpers(resultsRegistry, { onDecodeError: 'throw' })

  function unsupported(path: string, boundary: string): never {
    throw new Error(
      `[zodvex] Unsupported pagination ${boundary} schema for "${path}". ` +
        'Use an unrefined argument object and an unrefined return object with an unrefined page array. ' +
        'Item schemas may contain codecs and refinements. For whole-page checks or transforms, ' +
        'use query or subscribe with explicit paginationOpts.'
    )
  }

  function encodeArgs(ref: FunctionReference<'query'>, args: unknown): any {
    const path = resolveFunctionPath(ref)
    if (path !== null && !Object.hasOwn(argsRegistry, path)) {
      const schema = registry[path]?.args
      if (schema) {
        if (!(schema instanceof $ZodObject) || schema._zod.def.checks?.length) {
          unsupported(path, 'argument')
        }
        const { paginationOpts: _paginationOpts, ...shape } = schema._zod.def.shape
        argsRegistry[path] = { args: clone(schema, { ...schema._zod.def, shape }) }
      } else {
        argsRegistry[path] = {}
      }
    }
    return argsCodec.encodeArgs(ref, args)
  }

  function decodeResults(ref: FunctionReference<'query'>, results: unknown[]): any[] {
    const path = resolveFunctionPath(ref)
    if (path !== null && !Object.hasOwn(resultsRegistry, path)) {
      const schema = registry[path]?.returns
      if (schema) {
        if (!(schema instanceof $ZodObject) || schema._zod.def.checks?.length) {
          unsupported(path, 'return')
        }
        const page = schema._zod.def.shape.page
        if (!(page instanceof $ZodArray) || page._zod.def.checks?.length) {
          unsupported(path, 'page')
        }
        resultsRegistry[path] = { returns: page }
      } else {
        resultsRegistry[path] = {}
      }
    }
    return resultsCodec.decodeResult(ref, results)
  }

  return { encodeArgs, decodeResults }
}
