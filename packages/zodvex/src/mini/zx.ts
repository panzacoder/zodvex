import type { GenericId } from 'convex/values'
import type { $ZodCustom, $ZodNumber, $ZodType } from '../zod-core'
import { zx as _zx } from '../zx'
import type { ZodvexCodec } from './codec'

/** zx.id() return type for mini — no .optional() chaining */
export type ZxMiniId<TableName extends string> = $ZodType<GenericId<TableName>> & {
  _tableName: TableName
}

/** zx.date() return type for mini — no .optional() chaining */
export type ZxMiniDate = ZodvexCodec<$ZodNumber, $ZodCustom<Date, Date>>

function date(): ZxMiniDate {
  return _zx.date()
}

function id<TableName extends string>(tableName: TableName): ZxMiniId<TableName> {
  return _zx.id(tableName)
}

function codec<W extends $ZodType, R extends $ZodType>(
  wire: W,
  runtime: R,
  transforms: {
    decode: (wire: any) => any
    encode: (runtime: any) => any
  }
): ZodvexCodec<W, R> {
  return _zx.codec(wire, runtime, transforms)
}

/** The zx namespace typed for zod-mini compatibility. */
export const zx = {
  date,
  id,
  codec
} as const
