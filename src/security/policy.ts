/**
 * Policy resolution functions.
 *
 * This module provides functions to evaluate read and write policies
 * against an entitlement resolver to produce access decisions.
 */

import type {
  EntitlementCheckResult,
  EntitlementResolver,
  PolicyContext,
  ReadDecision,
  ReadPolicy,
  ReasonCode,
  WriteDecision,
  WritePolicy
} from './types'

/**
 * Options for policy resolution.
 */
export interface ResolveOptions {
  /** Reason to return when access is denied (no tier matches or requirement fails) */
  defaultDenyReason?: ReasonCode
}

/**
 * Normalize an entitlement check result to { ok, reason? } form.
 */
function normalizeResult(result: EntitlementCheckResult): { ok: boolean; reason?: ReasonCode } {
  if (typeof result === 'boolean') {
    return { ok: result }
  }
  return result
}

/**
 * Resolve a read policy to determine the access level for a sensitive field.
 *
 * Evaluates policy tiers in order. The first tier whose requirements are
 * satisfied by the resolver determines the access level. If no tier matches,
 * returns 'hidden' (default deny).
 *
 * SECURITY: If the resolver throws an exception, this function fails closed
 * by returning 'hidden' status. This prevents misconfigured or failing
 * resolvers from exposing sensitive data.
 *
 * @param context - The policy context (ctx, path, meta, doc, operation)
 * @param policies - The ordered array of read policy tiers
 * @param resolver - Function to check if requirements are satisfied
 * @param options - Additional options (defaultDenyReason)
 * @returns The read decision (status, reason, mask)
 */
export async function resolveReadPolicy<TCtx, TReq, TDoc>(
  context: PolicyContext<TCtx, TReq, TDoc>,
  policies: ReadPolicy<TReq>,
  resolver: EntitlementResolver<TCtx, TReq, TDoc>,
  options?: ResolveOptions
): Promise<ReadDecision> {
  // Check each tier in order
  for (const tier of policies) {
    let result: { ok: boolean; reason?: ReasonCode }

    try {
      result = normalizeResult(await resolver(context, tier.requirements))
    } catch (e) {
      // SECURITY: Fail closed on resolver error - hide the field
      console.error('Entitlement resolver threw an exception, failing closed:', e)
      return {
        status: 'hidden',
        reason: 'resolver_error'
      }
    }

    if (result.ok) {
      // This tier matches - return its status
      return {
        status: tier.status,
        reason: result.reason ?? tier.reason,
        mask: tier.status === 'masked' ? tier.mask : undefined
      }
    }
  }

  // No tier matched - default deny (hidden)
  return {
    status: 'hidden',
    reason: options?.defaultDenyReason
  }
}

/**
 * Resolve a write policy to determine if a write is allowed.
 *
 * Unlike read policies (which have multiple tiers), write is binary:
 * either the requirements are met (allowed) or not (denied).
 *
 * If no write policy is provided, writes are allowed by default.
 *
 * SECURITY: If the resolver throws an exception, this function fails closed
 * by returning denied. This prevents misconfigured or failing resolvers
 * from allowing unauthorized writes.
 *
 * @param context - The policy context (ctx, path, meta, doc, operation)
 * @param policy - The write policy (or undefined for default allow)
 * @param resolver - Function to check if requirements are satisfied
 * @param options - Additional options (defaultDenyReason)
 * @returns The write decision (allowed, reason)
 */
export async function resolveWritePolicy<TCtx, TReq, TDoc>(
  context: PolicyContext<TCtx, TReq, TDoc>,
  policy: WritePolicy<TReq> | undefined,
  resolver: EntitlementResolver<TCtx, TReq, TDoc>,
  options?: ResolveOptions
): Promise<WriteDecision> {
  // No policy = allow by default
  if (!policy) {
    return { allowed: true }
  }

  let result: { ok: boolean; reason?: ReasonCode }

  try {
    result = normalizeResult(await resolver(context, policy.requirements))
  } catch (e) {
    // SECURITY: Fail closed on resolver error - deny the write
    console.error('Entitlement resolver threw an exception, failing closed:', e)
    return {
      allowed: false,
      reason: 'resolver_error'
    }
  }

  if (result.ok) {
    return { allowed: true, reason: result.reason }
  }

  // Denied - determine reason (resolver > policy > default)
  const reason = result.reason ?? policy.reason ?? options?.defaultDenyReason

  return {
    allowed: false,
    reason
  }
}
