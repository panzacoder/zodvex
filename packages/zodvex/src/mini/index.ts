/**
 * zodvex/mini - Client-safe validators typed for zod-mini compatibility
 *
 * Re-exports everything from zodvex/core, but overrides `zx` helpers
 * with types that use `$ZodType` from `zod/v4/core` instead of `z.ZodType`
 * from full zod. This means return types don't have `.optional()` /
 * `.nullable()` chaining — use `z.optional(zx.id(...))` instead.
 *
 * Use this entrypoint when your project uses `zod/mini`.
 * Use `zodvex/core` when your project uses full `zod`.
 */

// Re-export everything from core EXCEPT zx
export {
  // Codec helpers
  type BoundaryHelpers,
  type BoundaryHelpersOptions,
  // Codec utilities
  type ConvexCodec,
  // Mapping
  type ConvexValidatorFromZod,
  type ConvexValidatorFromZodFieldsAuto,
  convexCodec,
  createBoundaryHelpers,
  decodeDoc,
  encodeDoc,
  encodePartialDoc,
  // Codegen runtime utilities
  extractCodec,
  getObjectShape,
  // Utilities
  mapDateFieldToNumber,
  // Codec error path normalization
  normalizeCodecPaths,
  pickShape,
  readFnArgs,
  readFnReturns,
  returnsAs,
  safeEncode,
  safeOmit,
  safePick,
  stripUndefined,
  // ID utilities
  type Zid,
  type ZodValidator,
  type ZodvexCodec,
  ZodvexDecodeError,
  zid,
  zodToConvex,
  zodToConvexFields,
  zodvexCodec,
  zPaginated
} from '../core'

// Re-export model types (ZodModel generic works for both full/mini via Schemas param)
export {
  type FieldPaths,
  type FullZodModelSchemas,
  type ModelFieldPaths,
  type ModelSchemas,
  type SearchIndexConfig,
  type VectorIndexConfig,
  type ZodModel
} from '../model'

// --- Mini-typed defineZodModel ---
// Same runtime, but return type uses ZodMiniObject/ZodMiniArray etc.
// so that model.schema.doc is assignable to z.ZodMiniType and has the mini API surface.
import type {
  ZodMiniArray,
  ZodMiniBoolean,
  ZodMiniNullable,
  ZodMiniNumber,
  ZodMiniObject,
  ZodMiniOptional,
  ZodMiniString
} from 'zod/mini'
import {
  defineZodModel as _defineZodModel,
  type ModelSchemas as _ModelSchemas,
  type ZodModel as _ZodModel
} from '../model'
import type { $ZodObject, $ZodShape } from '../zod-core'

/** Mini-typed schema bundle for ZodModel from zodvex/mini */
export type MiniModelSchemas<Name extends string, Fields extends $ZodShape> = {
  readonly doc: ZodMiniObject<Fields & { _id: ZxMiniId<Name>; _creationTime: ZodMiniNumber }>
  readonly base: ZodMiniObject<Fields>
  readonly insert: ZodMiniObject<Fields>
  readonly update: ZodMiniObject<
    { _id: ZxMiniId<Name>; _creationTime: ZodMiniOptional<ZodMiniNumber> } & {
      [K in keyof Fields]: ZodMiniOptional<Fields[K]>
    }
  >
  readonly docArray: ZodMiniArray<
    ZodMiniObject<Fields & { _id: ZxMiniId<Name>; _creationTime: ZodMiniNumber }>
  >
  readonly paginatedDoc: ZodMiniObject<{
    page: ZodMiniArray<
      ZodMiniObject<Fields & { _id: ZxMiniId<Name>; _creationTime: ZodMiniNumber }>
    >
    isDone: ZodMiniBoolean
    continueCursor: ZodMiniOptional<ZodMiniNullable<ZodMiniString>>
  }>
}

export const defineZodModel: {
  <Name extends string, Fields extends $ZodShape>(
    name: Name,
    fields: Fields
    // biome-ignore lint/complexity/noBannedTypes: {} is intentional — represents zero indexes/searchIndexes/vectorIndexes
  ): _ZodModel<Name, Fields, $ZodObject<Fields>, MiniModelSchemas<Name, Fields>, {}, {}, {}>
  <Name extends string, Schema extends $ZodType>(
    name: Name,
    schema: Schema
    // biome-ignore lint/complexity/noBannedTypes: {} is intentional — represents zero indexes/searchIndexes/vectorIndexes
  ): _ZodModel<Name, $ZodShape, Schema, _ModelSchemas, {}, {}, {}>
} = _defineZodModel as any

// Re-export registry
export * from '../registry'

// Re-export results
export * from '../results'

// Re-export schema types
export type { ZodTableMap, ZodTableSchemas } from '../schema'

// Re-export types
export * from '../types'

// --- Mini-typed zx ---
// Same runtime implementation, but typed with $ZodType from zod/v4/core
// so that return values are compatible with zod-mini's type system.
// Users should use z.optional(zx.id(...)) instead of zx.id(...).optional()

import type { GenericId } from 'convex/values'
import type { ZodvexCodec } from '../types'
import type { $ZodCodec, $ZodType } from '../zod-core'
import { zx as _zx } from '../zx'

/** zx.id() return type for mini — no .optional() chaining */
export type ZxMiniId<TableName extends string> = $ZodType<GenericId<TableName>> & {
  _tableName: TableName
}

/** zx.date() return type for mini — no .optional() chaining */
export type ZxMiniDate = $ZodType<Date>

/** The zx namespace typed for zod-mini compatibility */
export const zx: {
  date: () => ZxMiniDate
  id: <TableName extends string>(tableName: TableName) => ZxMiniId<TableName>
  codec: <W extends $ZodType, R extends $ZodType>(
    wire: W,
    runtime: R,
    transforms: {
      decode: (wire: any) => any
      encode: (runtime: any) => any
    }
  ) => ZodvexCodec<W, R>
} = _zx as any
