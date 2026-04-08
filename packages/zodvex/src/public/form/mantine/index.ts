import type { FunctionReference } from 'convex/server'
import { getFunctionName } from 'convex/server'
import { z } from 'zod'
import type { AnyRegistry } from '../../../internal/types'

/**
 * Creates a Mantine form validator from the zodvex registry.
 *
 * Looks up the args schema for a Convex function reference and returns
 * a Mantine-compatible validation function. Single source of truth —
 * the same schema that drives server validation drives form validation.
 *
 * Uses inline `z.safeParse` — no external dependencies required.
 *
 * @example
 * ```tsx
 * import { useForm } from '@mantine/form'
 * import { mantineResolver } from 'zodvex/form/mantine'
 *
 * const form = useForm({
 *   initialValues: { name: '', email: '' },
 *   validate: mantineResolver(registry, api.users.create),
 * })
 * ```
 */
export function mantineResolver<R extends AnyRegistry>(
  registry: R,
  ref: FunctionReference<any, any, any, any>
) {
  const path = getFunctionName(ref)
  const entry = registry[path]
  const schema = entry?.args
  if (!schema) {
    throw new Error(`zodvex: No args schema found for "${path}" in registry`)
  }

  return (values: Record<string, unknown>) => {
    const result = z.safeParse(schema, values)
    if (result.success) return {}
    const errors: Record<string, string> = {}
    for (const issue of result.error.issues) {
      errors[issue.path.join('.')] = issue.message
    }
    return errors
  }
}
