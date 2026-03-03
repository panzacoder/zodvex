import { z } from 'zod'
import type { FunctionReference } from 'convex/server'
import { getFunctionName } from 'convex/server'
import type { AnyRegistry } from '../../types'

/**
 * Creates a Mantine form validator from the zodvex registry.
 *
 * Uses `z.safeEncode` (runtime → wire direction) so that codec fields
 * like `sensitive()` validate runtime values (e.g. SensitiveField instances)
 * rather than expecting wire format input.
 *
 * For non-codec schemas, `safeEncode` behaves identically to `safeParse`.
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
    const result = z.safeEncode(schema, values)
    if (result.success) return {}
    const errors: Record<string, string> = {}
    for (const issue of result.error.issues) {
      errors[issue.path.join('.')] = issue.message
    }
    return errors
  }
}
