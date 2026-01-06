/**
 * Type definitions for the Field-Level Security (FLS) system.
 *
 * This module provides shared types for:
 * - DB storage shapes (SensitiveDb)
 * - Wire format for API responses (SensitiveWire)
 * - Policy definitions (ReadPolicy, WritePolicy)
 * - Policy resolution (ReadDecision, WriteDecision)
 * - Entitlement resolver signatures
 */

// ============================================================================
// DB Storage Shape
// ============================================================================

/**
 * The shape of sensitive data as stored in the Convex database.
 *
 * This branded wrapper allows sensitive fields to be indexed and queried
 * via paths like `email.__sensitiveValue`.
 */
export type SensitiveDb<T> = {
  __sensitiveValue: T
  __checksum?: string
  __algo?: string
}

// ============================================================================
// Wire Format
// ============================================================================

/**
 * The access status for a sensitive field in API responses.
 * - 'full': User has full access, sees the actual value
 * - 'masked': User has partial access, sees a masked/redacted value
 * - 'hidden': User has no access, value is null/omitted
 */
export type SensitiveStatus = 'full' | 'masked' | 'hidden'

/**
 * A string identifier for why access was granted or denied.
 * Used for debugging, logging, and user feedback.
 */
export type ReasonCode = string

/**
 * The wire format for sensitive fields sent to clients.
 *
 * Provides a uniform envelope that indicates access level and
 * includes the value (or null for hidden fields).
 */
export type SensitiveWire<T = unknown> = {
  /** Optional field name marker for debugging/logging */
  __sensitiveField?: string | null
  /** The access level for this field */
  status: SensitiveStatus
  /** The actual value (full), masked value, or null (hidden) */
  value: T | null
  /** Why this access level was granted */
  reason?: ReasonCode
}

// ============================================================================
// Policy Definitions
// ============================================================================

/**
 * A single tier in a read policy.
 *
 * Policies are evaluated in order; the first tier whose requirements
 * are met determines the access level.
 */
export type ReadPolicyTier<TReq = unknown> = {
  /** The access level granted if requirements are met */
  status: 'full' | 'masked'
  /** Requirements that must be satisfied (checked by resolver) */
  requirements: TReq
  /** Optional mask function for 'masked' status */
  mask?: (value: unknown) => unknown
  /** Optional reason code to return when this tier matches */
  reason?: ReasonCode
}

/**
 * A read policy is an ordered array of tiers.
 *
 * Tiers are checked in order; first match wins.
 * If no tier matches, the default is 'hidden' (deny).
 */
export type ReadPolicy<TReq = unknown> = ReadPolicyTier<TReq>[]

/**
 * A write policy defines requirements for modifying a sensitive field.
 *
 * Unlike read policies (which have multiple tiers), write is binary:
 * either the requirements are met (allowed) or not (denied).
 */
export type WritePolicy<TReq = unknown> = {
  /** Requirements that must be satisfied to write */
  requirements: TReq
  /** Optional reason code to return on denial */
  reason?: ReasonCode
}

/**
 * Metadata attached to a Zod schema via .meta() to mark it as sensitive.
 */
export type SensitiveMetadata<TReq = unknown> = {
  /** Always true for sensitive fields */
  sensitive: true
  /** Read access policy (optional; default: hidden) */
  read?: ReadPolicy<TReq>
  /** Write access policy (optional; default: allow) */
  write?: WritePolicy<TReq>
}

// ============================================================================
// Decision Types
// ============================================================================

/**
 * The result of evaluating a read policy for a single field.
 */
export type ReadDecision = {
  /** The resulting access level */
  status: SensitiveStatus
  /** Why this decision was made */
  reason?: ReasonCode
  /** Mask function to apply (only for 'masked' status) */
  mask?: (value: unknown) => unknown
}

/**
 * The result of evaluating a write policy for a single field.
 */
export type WriteDecision = {
  /** Whether the write is allowed */
  allowed: boolean
  /** Why the decision was made */
  reason?: ReasonCode
}

// ============================================================================
// Resolver Types
// ============================================================================

/**
 * The result of checking entitlements.
 *
 * Can be a simple boolean or an object with additional reason info.
 */
export type EntitlementCheckResult = boolean | { ok: boolean; reason?: ReasonCode }

/**
 * Context provided to the entitlement resolver when checking a policy.
 *
 * @template TCtx - The Convex context type (QueryCtx, MutationCtx, etc.)
 * @template TReq - The requirements type used in policies
 * @template TDoc - The document type being accessed
 */
export type PolicyContext<TCtx, TReq = unknown, TDoc = unknown> = {
  /** The Convex context (for auth, db access, etc.) */
  ctx: TCtx
  /** The field path being accessed (e.g., 'email', 'profile.ssn') */
  path: string
  /** The sensitive metadata for this field */
  meta: SensitiveMetadata<TReq>
  /** The document being accessed (if available) */
  doc?: TDoc
  /** Whether this is a read or write operation */
  operation: 'read' | 'write'
}

/**
 * A function that checks whether requirements are satisfied.
 *
 * Resolvers are provided by the application and bridge between
 * policy requirements and the actual entitlement/permission system.
 *
 * @template TCtx - The Convex context type
 * @template TReq - The requirements type used in policies
 * @template TDoc - The document type being accessed
 */
export type EntitlementResolver<TCtx, TReq = unknown, TDoc = unknown> = (
  context: PolicyContext<TCtx, TReq, TDoc>,
  requirements: TReq
) => EntitlementCheckResult | Promise<EntitlementCheckResult>
