import { z } from 'zod'
import { zx } from 'zodvex/core'

const STATE_MAP: Record<string, string> = {
  CA: 'California',
  NY: 'New York',
  TX: 'Texas',
}

const REVERSE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_MAP).map(([k, v]) => [v, k])
)

/**
 * Custom codec: 2-letter state codes <-> full state names.
 *
 * Wire format (stored in Convex): "CA", "NY", "TX"
 * Runtime format (used in code): "California", "New York", "Texas"
 */
export const stateCode = () =>
  zx.codec(
    z.string(), // wire
    z.string(), // runtime
    {
      decode: (code: string) => STATE_MAP[code] ?? code,
      encode: (name: string) => REVERSE_MAP[name] ?? name,
    }
  )
