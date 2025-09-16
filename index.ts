export { zodToConvex, zodToConvexFields, analyzeZod, getObjectShape, makeUnion, simpleToConvex } from './src/mapping'
export { convexCodec, type ConvexCodec, toConvexJS, fromConvexJS } from './src/codec'
export { zQuery, zInternalQuery, zMutation, zInternalMutation, zAction, zInternalAction } from './src/wrappers'
export { zCustomQuery, zCustomMutation, zCustomAction } from './src/custom'
export { zodTable, zCrud } from './src/tables'
export type { InferArgs, InferReturns, ExtractCtx, PreserveReturnType, ZodToConvexArgs } from './src/types'
export { zid, type Zid } from 'convex-helpers/server/zodV4'

import { zodToConvex as _zodToConvex, zodToConvexFields as _zodToConvexFields } from './src/mapping'
const defaultExport = {
  zodToConvex: _zodToConvex,
  zodToConvexFields: _zodToConvexFields
}
export default defaultExport

