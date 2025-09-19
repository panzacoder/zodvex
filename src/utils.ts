import { z } from 'zod'

export function pick<T extends Record<string, any>, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>
  for (const key of keys) {
    if (key in obj) result[key] = obj[key]
  }
  return result
}

// Typed identity helper for returns schemas
export function returnsAs<R extends z.ZodTypeAny>() {
  return <T extends z.input<R>>(v: T) => v
}
