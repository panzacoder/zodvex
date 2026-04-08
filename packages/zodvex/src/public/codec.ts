import {
  zodvexCodec as _zodvexCodec,
  type ConvexCodec,
  convexCodec,
  decodeDoc,
  encodeDoc,
  encodePartialDoc
} from '../internal/codec'
import type { $ZodType, output as zoutput } from '../internal/zod-core'
import type { FullZodvexCodec } from '../internal/zx'

export { type ConvexCodec, convexCodec, decodeDoc, encodeDoc, encodePartialDoc }

export type ZodvexCodec<Wire extends $ZodType, Runtime extends $ZodType> = FullZodvexCodec<
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
  return _zodvexCodec(wire, runtime, transforms) as unknown as ZodvexCodec<W, R>
}
