import {
  zodvexCodec as _zodvexCodec,
  type ConvexCodec,
  convexCodec,
  decodeDoc,
  encodeDoc,
  encodePartialDoc
} from '../codec'
import type { ZodvexCodec as SharedZodvexCodec } from '../types'
import type { $ZodType, output as zoutput } from '../zod-core'

export { type ConvexCodec, convexCodec, decodeDoc, encodeDoc, encodePartialDoc }

export type ZodvexCodec<Wire extends $ZodType, Runtime extends $ZodType> = SharedZodvexCodec<
  Wire,
  Runtime
>

export function zodvexCodec<
  W extends $ZodType,
  R extends $ZodType,
  WO = zoutput<W>,
  RI = zoutput<R>
>(
  wire: W,
  runtime: R,
  transforms: {
    decode: (wire: WO) => RI
    encode: (runtime: RI) => WO
  }
): ZodvexCodec<W, R> {
  return _zodvexCodec(wire, runtime, transforms)
}
