import { z } from 'zod'
import { zx } from '../../../src/internal/zx'

export const zDuration = zx.codec(
  z.number(),
  z.object({ hours: z.number(), minutes: z.number() }),
  {
    decode: (mins: number) => ({ hours: Math.floor(mins / 60), minutes: mins % 60 }),
    encode: (d: { hours: number; minutes: number }) => d.hours * 60 + d.minutes
  }
)

// zx.date() should NOT be discovered as a custom codec
export const zCreatedAt = zx.date()
