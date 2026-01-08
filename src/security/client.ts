/**
 * Client-side utilities for working with sensitive field data.
 *
 * This module is framework-agnostic and provides utilities for:
 * - Checking if data is in sensitive wire format
 * - Extracting values with status-awareness
 * - Type helpers for working with responses containing sensitive fields
 *
 * @example
 * ```ts
 * import { getFieldValue, isFieldHidden } from 'zodvex/security/client'
 *
 * function UserEmail({ email }: { email: SensitiveWire<string> }) {
 *   if (isFieldHidden(email)) {
 *     return <span className="text-muted">[hidden]</span>
 *   }
 *   return <span>{getFieldValue(email)}</span>
 * }
 * ```
 */

import type { SensitiveStatus, SensitiveWire } from './types'

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is in sensitive field wire format.
 *
 * Wire format has `status` and `value` properties.
 */
export function isSensitiveFieldData(value: unknown): value is SensitiveWire {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    'value' in value &&
    typeof (value as Record<string, unknown>).status === 'string'
  )
}

/**
 * Check if a sensitive field has full access.
 */
export function isFieldFull(field: SensitiveWire): boolean {
  return field.status === 'full'
}

/**
 * Check if a sensitive field has masked access.
 */
export function isFieldMasked(field: SensitiveWire): boolean {
  return field.status === 'masked'
}

/**
 * Check if a sensitive field is hidden.
 */
export function isFieldHidden(field: SensitiveWire): boolean {
  return field.status === 'hidden'
}

// ============================================================================
// Value Extraction
// ============================================================================

/**
 * Get the value from a sensitive field, with optional default for hidden fields.
 *
 * @param field - The sensitive field wire data
 * @param defaultValue - Value to return if field is hidden (default: null)
 * @returns The field value, or defaultValue if hidden
 *
 * @example
 * ```ts
 * const email = getFieldValue(user.email) // string | null
 * const emailOrFallback = getFieldValue(user.email, 'N/A') // string
 * ```
 */
export function getFieldValue<T>(field: SensitiveWire<T>): T | null
export function getFieldValue<T, D>(field: SensitiveWire<T>, defaultValue: D): T | D
export function getFieldValue<T, D>(field: SensitiveWire<T>, defaultValue?: D): T | D | null {
  if (field.status === 'hidden') {
    return defaultValue !== undefined ? defaultValue : null
  }
  return field.value as T
}

// ============================================================================
// Response Deserialization
// ============================================================================

/**
 * Deserialize a response from the server.
 *
 * This is mostly a pass-through that preserves the structure.
 * The wire format is already JSON-compatible, so no transformation
 * is needed. This function exists for symmetry with serializeToWire
 * and to provide a clear entry point for response handling.
 *
 * @param response - The response from the server
 * @returns The response with sensitive fields in wire format
 */
export function deserializeResponse<T>(response: T): T {
  // Wire format is already deserialized JSON - just return it
  // This function exists for API symmetry and as a clear entry point
  return response
}

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Transform a type to replace SensitiveField<T> with SensitiveWire<T>.
 *
 * Use this to type API response objects that contain sensitive fields.
 *
 * @example
 * ```ts
 * type ServerUser = {
 *   name: string
 *   email: SensitiveField<string>
 * }
 *
 * type ClientUser = WithSensitiveWire<ServerUser>
 * // { name: string; email: SensitiveWire<string> }
 * ```
 */
export type WithSensitiveWire<T> = T extends { status: SensitiveStatus; value: unknown }
  ? T // Already wire format
  : T extends object
    ? { [K in keyof T]: WithSensitiveWire<T[K]> }
    : T

/**
 * Extract the value type from a SensitiveWire type.
 *
 * @example
 * ```ts
 * type EmailValue = SensitiveValue<SensitiveWire<string>> // string
 * ```
 */
export type SensitiveValue<T> = T extends SensitiveWire<infer V> ? V : never
