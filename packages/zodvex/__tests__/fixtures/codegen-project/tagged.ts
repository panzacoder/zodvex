import { z } from 'zod'
import { zx } from '../../../src/zx'

export function tagged<T extends z.ZodTypeAny>(inner: T) {
  return zx.codec(
    z.object({ value: inner, tag: z.string() }),
    z.object({ value: inner, tag: z.string(), display: z.string() }),
    {
      decode: (w: any) => ({ ...w, display: `[${w.tag}] ${w.value}` }),
      encode: (r: any) => ({ value: r.value, tag: r.tag })
    }
  )
}
