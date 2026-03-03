import type { FunctionReference } from 'convex/server'
import { getFunctionName } from 'convex/server'
import { zod4Resolver } from 'mantine-form-zod-resolver'
import type { AnyRegistry } from '../../types'

/**
 * Creates a Mantine form validator from the zodvex registry.
 *
 * Looks up the args schema for a Convex function reference and returns
 * a Mantine-compatible validation function. Single source of truth —
 * the same schema that drives server validation drives form validation.
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
  if (!entry?.args) {
    throw new Error(`zodvex: No args schema found for "${path}" in registry`)
  }
  return zod4Resolver(entry.args)
}
