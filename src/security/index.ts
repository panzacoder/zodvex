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

// Sensitive marker and ZodSensitive wrapper
export {
  SENSITIVE_META_KEY,
  ZodSensitive,
  type ZodSensitiveDef,
  sensitive,
  isZodSensitive,
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

// SensitiveField runtime class
export { SensitiveField, type FromDbValueOptions } from './sensitive-field'

// Wire format helpers
export { serializeToWire, deserializeFromWire, isSensitiveWire } from './wire'

// Fail-secure defaults
export {
  autoLimit,
  assertNoSensitive,
  type AutoLimitOptions,
  type AssertNoSensitiveOptions
} from './fail-secure'

// Row-Level Security (RLS)
export { checkRlsRead, checkRlsWrite, filterByRls } from './rls'
export type { RlsRule, RlsRules, RlsCheckResult } from './types'

// Secure DB wrappers
export { createSecureReader, createSecureWriter, type SecureDbConfig, type DeniedInfo } from './db'

// Secure function wrappers
export {
  zSecureQuery,
  zSecureMutation,
  zSecureAction,
  type SecureConfig,
  type SecureActionConfig
} from './secure-wrappers'
