import { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

/**
 * Result type for mutations that return data on success.
 */
export type MutationResult<T> = { success: true; data: T } | { success: false; error: string }

/**
 * Result type for mutations that don't return data (void operations).
 */
export type VoidMutationResult = { success: true } | { success: false; error: string }

/**
 * Error structure for form validation results.
 */
export type FormError = {
  formErrors: string[]
  fieldErrors: Record<string, string[]>
}

/**
 * Result type for form submissions with field-level error support.
 * Preserves submitted data on failure for form re-population.
 */
export type FormResult<TData> =
  | { success: true; data: TData }
  | { success: false; data: TData; error: FormError }

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a success result with data.
 * @example success({ id: '123' })
 */
export const success = <T>(data: T) => ({ success: true, data }) as const

/**
 * Create a failure result with an error message.
 * @example failure('Not found')
 */
export const failure = (error: string) => ({ success: false, error }) as const

/**
 * Create a void success result (no data).
 * @example ok()
 */
export const ok = () => ({ success: true }) as const

/**
 * Create a form success result with data.
 * @example formSuccess({ email: 'user@example.com' })
 */
export const formSuccess = <T>(data: T) => ({ success: true, data }) as const

/**
 * Create a form failure result with data and errors.
 * @example formFailure({ email: 'bad' }, { formErrors: [], fieldErrors: { email: ['Invalid'] } })
 */
export const formFailure = <T>(data: T, error: FormError) =>
  ({ success: false, data, error }) as const

// ============================================================================
// Zod Schemas for `returns` validation
// ============================================================================

/**
 * Zod schema for MutationResult<T>.
 * Use in `returns` option to validate mutation responses.
 * @example zMutationResult(z.object({ id: zid('users') }))
 */
export const zMutationResult = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.discriminatedUnion('success', [
    z.object({ success: z.literal(true), data: dataSchema }),
    z.object({ success: z.literal(false), error: z.string() })
  ])

/**
 * Zod schema for VoidMutationResult.
 * Use in `returns` option for void mutations.
 * @example returns: zVoidMutationResult
 */
export const zVoidMutationResult = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true) }),
  z.object({ success: z.literal(false), error: z.string() })
])

/**
 * Zod schema for FormError.
 */
export const zFormError = z.object({
  formErrors: z.array(z.string()),
  fieldErrors: z.record(z.string(), z.array(z.string()))
})

/**
 * Zod schema for FormResult<T>.
 * Use in `returns` option for form submissions.
 * @example zFormResult(z.object({ email: z.string() }))
 */
export const zFormResult = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.discriminatedUnion('success', [
    z.object({ success: z.literal(true), data: dataSchema }),
    z.object({ success: z.literal(false), data: dataSchema, error: zFormError })
  ])
