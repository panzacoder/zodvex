import { z } from 'zod'
import { zx } from 'zodvex'

/**
 * Duration codec — stores total minutes (wire), exposes { hours, minutes } (runtime).
 * Demonstrates zx.codec() with distinct wire and runtime formats.
 */
export const zDuration = zx.codec(
  z.number(),
  z.object({ hours: z.number(), minutes: z.number() }),
  {
    decode: (mins) => ({ hours: Math.floor(mins / 60), minutes: mins % 60 }),
    encode: (d) => d.hours * 60 + d.minutes,
  }
)
