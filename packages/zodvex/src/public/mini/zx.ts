import type { GenericId } from 'convex/values'
import type { ZodMiniCustom, ZodMiniNumber, ZodMiniString, ZodMiniType } from 'zod/mini'
import type { $ZodType } from '../../internal/zod-core'
import { zx as _zx } from '../../internal/zx'
import type { ZodvexCodec } from './codec'

/** zx.id() return type for mini — no .optional() chaining */
export type ZxMiniId<TableName extends string> = ZodMiniString &
  ZodMiniType<GenericId<TableName>> & {
    _tableName: TableName
  }

/** zx.date() return type for mini — no .optional() chaining */
export type ZxMiniDate = ZodvexCodec<ZodMiniNumber, ZodMiniCustom<Date, Date>>

function date(): ZxMiniDate {
  return _zx.date() as unknown as ZxMiniDate
}

function id<TableName extends string>(tableName: TableName): ZxMiniId<TableName> {
  return _zx.id(tableName) as unknown as ZxMiniId<TableName>
}

function codec<W extends $ZodType, R extends $ZodType>(
  wire: W,
  runtime: R,
  transforms: {
    decode: (wire: any) => any
    encode: (runtime: any) => any
  }
): ZodvexCodec<W, R> {
  return _zx.codec(wire, runtime, transforms) as unknown as ZodvexCodec<W, R>
}

/** The zx namespace typed for zod-mini compatibility. */
export const zx = {
  date,
  id,
  codec,
  paginationOpts: _zx.paginationOpts,
  paginationResult: _zx.paginationResult,
  doc: _zx.doc,
  update: _zx.update,
  docArray: _zx.docArray
} as const
