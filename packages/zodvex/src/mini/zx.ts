import type { GenericId } from 'convex/values'
import { zx as _zx } from '../zx'
import type { ZodvexCodec } from '../types'
import type { $ZodCustom, $ZodNumber, $ZodType } from '../zod-core'

/** zx.id() return type for mini — no .optional() chaining */
export type ZxMiniId<TableName extends string> = $ZodType<GenericId<TableName>> & {
  _tableName: TableName
}

/** zx.date() return type for mini — no .optional() chaining */
export type ZxMiniDate = ZodvexCodec<$ZodNumber, $ZodCustom<Date, Date>>

/** The zx namespace typed for zod-mini compatibility. */
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
