/**
 * Field-Level Security (FLS) for zodvex.
 *
 * This module provides primitives for marking sensitive fields in Zod schemas
 * and applying read/write policies based on entitlements.
 */

// Types
export type {
  EntitlementCheckResult,
  EntitlementResolver,
  PolicyContext,
  ReadDecision,
  ReadPolicy,
  ReadPolicyTier,
  ReasonCode,
  SensitiveDb,
  SensitiveMetadata,
  SensitiveStatus,
  SensitiveWire,
  WriteDecision,
  WritePolicy
} from './types'

// Sensitive marker
export {
  SENSITIVE_META_KEY,
  sensitive,
  isSensitiveSchema,
  getSensitiveMetadata,
  findSensitiveFields,
  type SensitiveOptions,
  type SensitiveFieldInfo
} from './sensitive'

// Policy resolution
export { resolveReadPolicy, resolveWritePolicy, type ResolveOptions } from './policy'

// Apply policy transforms
export {
  applyReadPolicy,
  validateWritePolicy,
  assertWriteAllowed,
  type ApplyReadPolicyOptions,
  type WriteValidationResult,
  type ValidateWritePolicyOptions
} from './apply-policy'
