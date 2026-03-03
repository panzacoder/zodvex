import type { FunctionReference } from 'convex/server'
import { getFunctionName } from 'convex/server'
import { z } from 'zod'
import type { AnyRegistry } from '../../types'

/**
 * Unwrap ZodOptional/ZodNullable to find the inner schema.
 */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema
  for (let i = 0; i < 10; i++) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      current = (current as any)._zod.def.innerType
      continue
    }
    break
  }
  return current
}

/**
 * Build a form-safe schema by stripping codec fields from a ZodObject.
 *
 * Mantine's `useForm` uses `structuredClone` internally, which breaks class
 * instances (like SensitiveField). Codec fields can't be validated client-side
 * because the encode function expects methods that don't survive cloning.
 * They are validated server-side instead.
 *
 * For non-codec fields, validation is identical to the original schema.
 */
function buildFormSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  const unwrapped = unwrap(schema)
  if (!(unwrapped instanceof z.ZodObject)) return schema

  const shape = (unwrapped as any).shape as Record<string, z.ZodTypeAny> | undefined
  if (!shape) return schema

  const formShape: Record<string, z.ZodTypeAny> = {}
  for (const [key, fieldSchema] of Object.entries(shape)) {
    if (unwrap(fieldSchema) instanceof z.ZodCodec) continue
    formShape[key] = fieldSchema
  }
  return z.object(formShape)
}

/**
 * Creates a Mantine form validator from the zodvex registry.
 *
 * Validates non-codec fields client-side using `z.safeParse`. Codec fields
 * (like `sensitive()`) are automatically skipped because Mantine's `useForm`
 * uses `structuredClone`, which breaks class instances. Codec fields are
 * validated server-side instead.
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

  // Build a schema without codec fields — done once at creation time
  const formSchema = buildFormSchema(schema)

  return (values: Record<string, unknown>) => {
    const result = z.safeParse(formSchema, values)
    if (result.success) return {}
    const errors: Record<string, string> = {}
    for (const issue of result.error.issues) {
      errors[issue.path.join('.')] = issue.message
    }
    return errors
  }
}
