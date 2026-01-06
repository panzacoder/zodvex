# Issue #19: Return type is `Promise<any>` instead of inferred type

**Reporter:** @mount-memory
**Created:** 2025-10-26
**Status:** Investigation needed - likely by design
**Priority:** High (DX issue)
**Labels:** type-inference, developer-experience

## Problem Statement

User reports that return types from `zAction` (and likely other builders) are showing as `Promise<any>` instead of the inferred type from the `returns` schema.

### User's Code

```typescript
// Their helper setup (convex/util.ts or similar)
import { zActionBuilder, zMutationBuilder, zQueryBuilder } from 'zodvex'
import { action, mutation, query } from '../_generated/server'

const zAction = zActionBuilder(action)
const zMutation = zMutationBuilder(mutation)
const zQuery = zQueryBuilder(query)

export { zAction, zMutation, zQuery }

// Their action (actual return schema not provided yet)
export const someAction = zAction({
  args: { /* ... */ },
  returns: z.object({
    // User hasn't shared the actual return schema
  }),
  handler: async (ctx, args) => {
    return { /* ... */ }
  }
})
// Type shows: Promise<any> ❌
// Expected: Promise<{ ... }> ✅
```

### User's Schema

```typescript
// convex/schema.ts - Using standard Convex (NOT zodvex)
export const newsletterSignupStatus = v.union(
  v.literal('pending'),
  v.literal('verified'),
  v.literal('subscribed'),
  v.literal('unsubscribed'),
  v.literal('expired'),
)

export default defineSchema({
  newsletter_signups: defineTable({
    email: v.string(),
    status: newsletterSignupStatus,
    verifiedAt: v.optional(v.number()),
    verificationToken: v.string(),
    tokenExpiresAt: v.number(),
    jobId: v.optional(v.string()),
  })
    .index('by_email', ['email'])
    .index('by_token', ['verificationToken']),

  waitlist_questionnaire_responses: defineTable({
    newsletterId: v.id('newsletter_signups'),
    firstName: v.string(),
    lastName: v.string(),
    age: v.optional(v.number()),
  }),
})
```

**Key observation:** User is using standard Convex schema, not `zodTable`. This is fine - zodvex builders work with any schema.

## Root Cause Analysis

### The Intentional Bailout

From `src/types.ts:19-30`:

```typescript
export type InferReturns<R> = R extends z.ZodUnion<any>
  ? any  // <-- Intentionally bails to 'any' for unions
  : R extends z.ZodCustom<any>
    ? any  // <-- And for custom types
    : R extends z.ZodType<any, any, any>
      ? z.output<R>
      : R extends undefined
        ? any
        : R
```

**Why this exists:**
- Added to prevent TypeScript instantiation depth errors
- Complex unions can cause TypeScript to hit recursion limits
- Conservative bailout to maintain stability

**When it triggers:**
- Any `returns` schema containing `z.union()`
- Any `returns` schema containing `z.custom()`
- Potentially nested unions within objects

### User's Likely Scenario

**Hypothesis 1:** Return schema contains a union
```typescript
returns: z.object({
  status: z.union([
    z.literal('success'),
    z.literal('error')
  ])
})
// Triggers bailout -> Promise<any>
```

**Hypothesis 2:** Return schema uses `z.custom()`
```typescript
returns: z.object({
  userId: zid('users') // zid might use custom
})
// Triggers bailout -> Promise<any>
```

**Hypothesis 3:** TypeScript config issue
- Strict mode not enabled
- Type checking not running
- IDE cache issue

### Why Simple Objects Should Work

For a simple return schema without unions:
```typescript
returns: z.object({
  success: z.boolean(),
  message: z.string()
})
```

This should NOT trigger the bailout and should infer correctly to:
```typescript
Promise<{ success: boolean, message: string }>
```

## Information Needed from User

We need the user to provide:

1. **Full return schema** - The actual `returns:` definition
2. **Full action code** - Complete function definition
3. **TypeScript version** - From `package.json`
4. **zodvex version** - From `package.json`
5. **IDE** - VS Code, WebStorm, etc.
6. **Type checking status** - Is TypeScript running? Any errors?

## Draft Response to User

See below for the actual response to post.

## Potential Solutions

### Option 1: Remove Bailout for Top-Level Objects

Only bail for nested unions, not simple objects with union fields:

```typescript
export type InferReturns<R> =
  R extends z.ZodObject<infer Shape>
    ? // For objects, only bail if we detect deep nesting
      IsDeepUnion<Shape> extends true
      ? any
      : z.output<R>
    : R extends z.ZodUnion<any>
      ? any
      : R extends z.ZodCustom<any>
        ? any
        : R extends z.ZodType<any, any, any>
          ? z.output<R>
          : R extends undefined
            ? any
            : R

// Helper type to detect deeply nested unions
type IsDeepUnion<Shape> = /* complex type logic */
```

**Pros:**
- Better inference for common cases
- Only bails when actually necessary

**Cons:**
- More complex type logic
- May still hit depth limits in some cases

### Option 2: Make Bailout Optional

Add an option to disable bailout for users who know their schemas are safe:

```typescript
export const zAction = zActionBuilder(action, {
  strictInference: true // Disables any bailouts
})
```

**Pros:**
- Users can opt-in to better inference
- Backward compatible

**Cons:**
- More API surface
- Users need to understand the trade-off

### Option 3: Better Error Messages

If we bail, at least warn the user why:

```typescript
// In builder
if (hasUnion(returns) && process.env.NODE_ENV !== 'production') {
  console.warn(
    '[zodvex] Return type inference disabled for union schemas. ' +
    'See https://github.com/panzacoder/zodvex/issues/19'
  )
}
```

**Pros:**
- Doesn't change behavior
- Educates users
- Links to documentation

**Cons:**
- Runtime overhead (though only in dev)
- Console noise

### Option 4: Document the Limitation

Add to README.md and provide workarounds:

```md
### Return Type Inference with Unions

zodvex intentionally uses `any` for return types containing unions to avoid TypeScript depth errors. If you need strict typing:

**Workaround 1: Type assertion**
\`\`\`typescript
export const myAction = zAction({
  returns: z.object({ status: z.union([...]) }),
  handler: ...
}) satisfies RegisteredAction<'public', any, Promise<{ status: 'success' | 'error' }>>
\`\`\`

**Workaround 2: Avoid unions in returns**
\`\`\`typescript
// Instead of union
returns: z.object({ status: z.union([z.literal('success'), z.literal('error')]) })

// Use enum
returns: z.object({ status: z.enum(['success', 'error']) })
// Note: z.enum() also triggers bailout currently
\`\`\`

**Workaround 3: Manually type the function**
\`\`\`typescript
import type { RegisteredAction } from 'convex/server'

type MyActionReturn = { status: 'success' | 'error' }

export const myAction: RegisteredAction<'public', {}, Promise<MyActionReturn>> =
  zAction({
    returns: z.object({ status: z.union([...]) }),
    handler: ...
  })
\`\`\`
```

## Testing Requirements

### Reproduce the Issue
- [ ] Create minimal reproduction with user's exact setup
- [ ] Test with simple return schemas (should work)
- [ ] Test with union in return schema (triggers bailout)
- [ ] Test with `zid` in return schema (might trigger bailout)

### Test Proposed Solutions
- [ ] Test smarter bailout (Option 1)
- [ ] Test with `strictInference` flag (Option 2)
- [ ] Test warning messages (Option 3)
- [ ] Test documented workarounds (Option 4)

## Implementation Checklist

**Phase 1: Gather Information**
- [x] Draft response to user
- [ ] Wait for user's full schema
- [ ] Reproduce the issue locally
- [ ] Identify exact trigger

**Phase 2: Short-term Fix**
- [ ] Document limitation in README
- [ ] Add FAQ entry
- [ ] Provide workarounds
- [ ] Update issue with findings

**Phase 3: Long-term Solution**
- [ ] Implement smarter bailout (if needed)
- [ ] Add comprehensive tests
- [ ] Benchmark TypeScript performance
- [ ] Document any breaking changes

## Open Questions

1. **Why was the bailout added originally?**
   - Was there a specific issue it solved?
   - Can we reproduce the depth error it prevents?

2. **Can we detect when bailout happens and warn?**
   - Runtime detection possible?
   - Type-level detection possible?

3. **Do other libraries (convex-helpers, tRPC) have similar bailouts?**
   - How do they handle complex types?
   - What can we learn from them?

4. **What percentage of users hit this issue?**
   - Is it common or rare?
   - Should we prioritize fixing it?

## References

- Original Issue: https://github.com/panzacoder/zodvex/issues/19
- TypeScript Instantiation Depth: https://github.com/microsoft/TypeScript/wiki/Performance#preferring-base-types-over-unions
- Zod Type Inference: https://zod.dev/type-inference
- Related: Issue #22 (zid complexity)
