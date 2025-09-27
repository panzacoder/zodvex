# Fix for Type Instantiation Depth Issues in Motiion

## Problem
TypeScript runs out of memory when type-checking the motiion backend due to deep type recursion from large Zod schemas combined with zodvex transformations.

## Root Cause

The issue is in `/packages/backend/convex/schemas/users.ts` where a large schema with 50+ fields is being transformed multiple times:

1. `zUsers` - large object with many nested fields
2. `zUsers.pick()` - creates derived type
3. `zodToConvex()` - recursively transforms the entire type structure

This creates exponential type complexity that exceeds TypeScript's limits.

## Recommended Solutions

### Solution 1: Define picked fields separately (BEST)

Instead of using `.pick()` on the large schema, define the fields you need as a separate schema:

```typescript
// Instead of this:
export const zClerkCreateUserFields = zUsers.pick({
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  tokenId: true
})

// Do this:
export const zClerkCreateUserFields = z.object({
  email: z.string(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  tokenId: z.string()
})

export const clerkCreateUserFields = zodToConvex(zClerkCreateUserFields)
```

This avoids the type complexity of deriving from the large schema.

### Solution 2: Split large schemas into composable parts

```typescript
// Break up the 50+ field schema into logical groups
const userAuthFields = {
  tokenId: z.string(),
  email: z.string(),
  isAdmin: z.boolean(),
}

const userProfileFields = {
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  displayName: z.string().optional(),
  // ... other profile fields
}

const userSettingsFields = {
  onboardingCompleted: z.boolean().optional(),
  // ... other settings
}

// Compose them together
export const users = {
  ...userAuthFields,
  ...userProfileFields,
  ...userSettingsFields,
}

export const zUsers = z.object(users)

// Now you can reference the smaller parts directly
export const zClerkCreateUserFields = z.object({
  email: userAuthFields.email,
  tokenId: userAuthFields.tokenId,
  firstName: userProfileFields.firstName,
  lastName: userProfileFields.lastName,
  phone: userProfileFields.phone
})
```

### Solution 3: Use zodToConvexFields directly for simple conversions

If you just need the field validators without the full schema transformation:

```typescript
// Extract just the fields you need
const clerkFields = {
  email: users.email,
  firstName: users.firstName,
  lastName: users.lastName,
  phone: users.phone,
  tokenId: users.tokenId
}

export const clerkCreateUserFields = zodToConvexFields(clerkFields)
```

## What Changed in zodvex

1. Removed `zLoose` - it was an antipattern that broke type safety
2. Simplified `zodTable` to return just the table without type-heavy additions
3. Added `zodTableWithDocs` for backward compatibility if you need docSchema/docArray
4. Optimized to reduce type recursion while maintaining full type safety

## Key Principle

The problem isn't with zodvex or TypeScript - it's with patterns that create exponential type complexity. Large schemas (50+ fields) combined with operations like `.pick()` and recursive transformations will always hit limits. The solution is to structure your schemas in a way that avoids this complexity from the start.