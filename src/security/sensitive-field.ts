/**
 * SensitiveField runtime class.
 *
 * This class provides a type-safe wrapper for sensitive field values that:
 * - Carries the access status (full/masked/hidden)
 * - Provides status-aware value access via getValue()
 * - Serializes to/from wire format
 * - Prevents accidental value leaks via anti-coercion guards
 *
 * Key design decisions:
 * - No `unwrap()` method - always use `getValue()` which respects status
 * - `getValue()` returns null for hidden fields
 * - Values are stored in a WeakMap to prevent enumeration
 */

import type { ReasonCode, SensitiveDb, SensitiveStatus, SensitiveWire } from './types'

// Store values privately to prevent enumeration
const VALUES = new WeakMap<SensitiveField<unknown>, unknown>()

/**
 * Options for creating a SensitiveField from a DB value.
 */
export interface FromDbValueOptions {
  /** Mask function for masked status */
  mask?: (value: unknown) => unknown
  /** Reason code for the access level */
  reason?: ReasonCode
}

/**
 * A type-safe wrapper for sensitive field values.
 *
 * @example
 * ```ts
 * // Server-side: Create from policy decision
 * const field = SensitiveField.full(email, 'email')
 *
 * // Serialize for transport
 * const wire = field.toWire()
 *
 * // Client-side: Deserialize
 * const clientField = SensitiveField.fromWire(wire)
 *
 * // Access value (null if hidden)
 * const value = clientField.getValue()
 * ```
 */
export class SensitiveField<T> {
  /** The access status for this field */
  public readonly status: SensitiveStatus
  /** Optional field name for debugging/logging */
  public readonly field: string | undefined
  /** Optional reason code explaining the access level */
  public readonly reason: ReasonCode | undefined

  private constructor(
    value: T | null,
    status: SensitiveStatus,
    field?: string,
    reason?: ReasonCode
  ) {
    VALUES.set(this, value)
    this.status = status
    this.field = field
    this.reason = reason
  }

  // =========================================================================
  // Factory Methods
  // =========================================================================

  /**
   * Create a field with full access.
   */
  static full<T>(value: T, field?: string): SensitiveField<T> {
    return new SensitiveField(value, 'full', field)
  }

  /**
   * Create a field with masked access.
   * The value should already be masked before passing to this method.
   */
  static masked<T>(maskedValue: T, field?: string, reason?: ReasonCode): SensitiveField<T> {
    return new SensitiveField(maskedValue, 'masked', field, reason)
  }

  /**
   * Create a field with hidden (no) access.
   */
  static hidden<T>(field?: string, reason?: ReasonCode): SensitiveField<T> {
    return new SensitiveField<T>(null, 'hidden', field, reason)
  }

  /**
   * Create a SensitiveField from a database value based on access level.
   *
   * @param dbValue - The database-stored value
   * @param field - Optional field name
   * @param status - The access status to apply
   * @param options - Options including mask function and reason
   */
  static fromDbValue<T>(
    dbValue: SensitiveDb<T>,
    field: string | undefined,
    status: SensitiveStatus,
    options?: FromDbValueOptions
  ): SensitiveField<T> {
    const rawValue = dbValue.__sensitiveValue

    switch (status) {
      case 'full':
        return SensitiveField.full(rawValue, field)
      case 'masked': {
        const maskedValue = options?.mask ? (options.mask(rawValue) as T) : rawValue
        return SensitiveField.masked(maskedValue, field, options?.reason)
      }
      case 'hidden':
        return SensitiveField.hidden<T>(field, options?.reason)
      default:
        // Default deny - treat unknown status as hidden
        return SensitiveField.hidden<T>(field, 'unknown_status')
    }
  }

  /**
   * Deserialize from wire format.
   */
  static fromWire<T>(wire: SensitiveWire<T>): SensitiveField<T> {
    return new SensitiveField<T>(
      wire.value,
      wire.status,
      wire.__sensitiveField ?? undefined,
      wire.reason
    )
  }

  // =========================================================================
  // Value Access
  // =========================================================================

  /**
   * Get the value appropriate for the current status.
   *
   * - 'full': returns the full value
   * - 'masked': returns the masked value
   * - 'hidden': returns null
   */
  getValue(): T | null {
    if (this.status === 'hidden') {
      return null
    }
    return VALUES.get(this) as T
  }

  // =========================================================================
  // Status Helpers
  // =========================================================================

  /**
   * Check if this field has full access.
   */
  isFull(): boolean {
    return this.status === 'full'
  }

  /**
   * Check if this field has masked access.
   */
  isMasked(): boolean {
    return this.status === 'masked'
  }

  /**
   * Check if this field is hidden.
   */
  isHidden(): boolean {
    return this.status === 'hidden'
  }

  // =========================================================================
  // Serialization
  // =========================================================================

  /**
   * Serialize to wire format for transport.
   */
  toWire(): SensitiveWire<T> {
    const wire: SensitiveWire<T> = {
      status: this.status,
      value: this.getValue()
    }

    if (this.field !== undefined) {
      wire.__sensitiveField = this.field
    }

    if (this.reason !== undefined) {
      wire.reason = this.reason
    }

    return wire
  }

  /**
   * Custom JSON serialization.
   * Returns the wire format, NOT the raw value.
   */
  toJSON(): SensitiveWire<T> {
    return this.toWire()
  }

  // =========================================================================
  // Anti-Coercion Guards
  // =========================================================================

  /**
   * Prevents implicit string coercion from exposing the value.
   * Logs a warning to help identify accidental coercion.
   */
  toString(): string {
    console.warn(
      `Attempted to coerce SensitiveField${this.field ? ` (${this.field})` : ''} to string. ` +
        'Use getValue() to access the value explicitly.'
    )
    return '[SensitiveField]'
  }

  /**
   * Prevents implicit valueOf coercion.
   */
  valueOf(): string {
    return this.toString()
  }

  /**
   * Prevents Symbol.toPrimitive coercion (used by template literals).
   */
  [Symbol.toPrimitive](): string {
    return this.toString()
  }
}
