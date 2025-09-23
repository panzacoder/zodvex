# Motiion Project: Zodvex Migration Instructions

## Overview
The motiion backend is experiencing TypeScript out-of-memory errors due to type complexity from large Zod schemas. These instructions will guide you through fixing the issue while maintaining type safety.

## Step 1: Update zodvex to latest version
```bash
cd packages/backend
npm update zodvex@latest
```

## Step 2: Fix the users.ts schema file

### Current problematic pattern in `convex/schemas/users.ts`:
```typescript
// ❌ This causes type explosion
export const zUsers = z.object(users)  // 50+ fields
export const Users = zodTable('users', zUsers)

export const zClerkCreateUserFields = zUsers.pick({  // Deriving from huge schema
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  tokenId: true
})
export const clerkCreateUserFields = zodToConvex(zClerkCreateUserFields)
```

### Fix Option A: Define picked schema separately (SIMPLEST FIX)

Replace the picked schema with a standalone definition:

```typescript
// ✅ Define the subset directly instead of picking from large schema
export const zClerkCreateUserFields = z.object({
  email: z.string(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  tokenId: z.string()
})

export const clerkCreateUserFields = zodToConvex(zClerkCreateUserFields)

// Keep the rest as-is
export const zUsers = z.object(users)
export const Users = zodTable('users', zUsers)
```

### Fix Option B: Restructure into composable parts (BEST LONG-TERM)

1. **Split the large `users` object into logical groups:**

```typescript
// In convex/schemas/users.ts

// Group 1: Authentication fields
export const userAuthFields = {
  tokenId: z.string(),
  type: z.literal('member'),
  isAdmin: z.boolean(),
  email: z.string(),
}

// Group 2: Basic info
export const userBasicFields = {
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  displayName: z.string().optional(),
  fullName: z.string().optional(),
  phone: z.string().optional(),
  dateOfBirth: z.string().optional(),
}

// Group 3: Profile fields
export const userProfileFields = {
  profileTipDismissed: z.boolean().optional(),
  headshots: zFileUploadObjectArray.optional(),
  representation: zRepresentation.optional(),
  attributes: z.object(attributesPlainObject).optional(),
  sizing: z.object(sizingPlainObject).optional(),
  resume: zResume.optional(),
  links: zLinks.optional(),
}

// Group 4: Onboarding fields
export const userOnboardingFields = {
  onboardingCompleted: z.boolean().optional(),
  onboardingCompletedAt: z.string().optional(),
  onboardingVersion: z.string().optional(),
  currentOnboardingStep: z.string().optional(),
  currentOnboardingStepIndex: z.number().optional(),
  onboardingStep: z.string().optional(), // legacy
}

// Group 5: Other fields
export const userMiscFields = {
  searchPattern: z.string().optional(),
  pointsEarned: z.number(),
  profileType: z.enum(['dancer', 'choreographer', 'guest']).optional(),
  favoriteUsers: z.array(zid('users')).optional(),
  pushTokens: z.array(
    z.object({
      token: z.string(),
      platform: z.enum(['ios', 'android']),
      updatedAt: z.number()
    })
  ).optional(),
  location: zLocation.optional(),
  // ... rest of fields
}
```

2. **Compose the full schema from parts:**

```typescript
// Compose the complete user schema
export const users = {
  ...userAuthFields,
  ...userBasicFields,
  ...userProfileFields,
  ...userOnboardingFields,
  ...userMiscFields,
}

export const zUsers = z.object(users)
export const Users = zodTable('users', zUsers)
```

3. **Create derived schemas using the parts directly:**

```typescript
// Now you can create subsets without .pick()
export const zClerkCreateUserFields = z.object({
  email: userAuthFields.email,
  tokenId: userAuthFields.tokenId,
  firstName: userBasicFields.firstName,
  lastName: userBasicFields.lastName,
  phone: userBasicFields.phone,
})

export const clerkCreateUserFields = zodToConvex(zClerkCreateUserFields)
```

## Step 3: Check other schema files

Look for similar patterns in other files and apply the same fixes:

```bash
# Find other uses of .pick() that might cause issues
grep -r "\.pick(" convex/schemas/

# Find other large schemas passed to zodTable
grep -r "zodTable" convex/schemas/
```

For each file with large schemas:
- If using `.pick()`, define the subset as a separate schema
- If the schema has 30+ fields, consider splitting into logical groups

## Step 4: Test the changes

1. **Run type checking to verify it completes:**
```bash
npm run type-check
```

This should now complete without running out of memory.

2. **Run your Convex functions to ensure runtime behavior is unchanged:**
```bash
npm run dev
```

## Step 5: Update any imports if needed

If you restructured schemas into parts, update any files that import from the schema:

```typescript
// If you split into parts and other files need specific fields:
import { userAuthFields, userBasicFields } from './schemas/users'
```

## Key Rules to Prevent Future Issues

1. **Never use `.pick()` on schemas with 20+ fields** - Define the subset separately
2. **Split schemas with 30+ fields into logical groups** - Compose them together
3. **Avoid deeply nested schemas** - Flatten where possible
4. **Test type-checking regularly** - Catch issues early

## Verification Checklist

- [ ] Updated zodvex to latest version
- [ ] Fixed users.ts schema (removed .pick() or split into parts)
- [ ] Checked other schema files for similar patterns
- [ ] Type checking completes without errors
- [ ] Runtime behavior unchanged (test your API calls)
- [ ] No TypeScript errors in your IDE

## If Issues Persist

If you still have type depth issues after these changes:

1. Look for schemas with deeply nested objects (3+ levels deep)
2. Check for circular references between schemas
3. Consider flattening nested structures where possible
4. Use `zodToConvexFields()` directly for simple field mappings instead of `zodToConvex()`

## Example: Complete Fixed users.ts Structure

Here's what a fully fixed `users.ts` might look like:

```typescript
import { zid } from 'zodvex'
import { zodTable, zodToConvex, zodToConvexFields } from 'zodvex'
import { z } from 'zod'
import { zFileUploadObjectArray, zLocation } from './base'
import { attributesPlainObject } from './attributes'
import { sizingPlainObject } from './sizing'

// Define reusable field groups (can be imported by other files if needed)
export const userCoreFields = {
  tokenId: z.string(),
  type: z.literal('member'),
  isAdmin: z.boolean(),
  email: z.string(),
}

export const userInfoFields = {
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  displayName: z.string().optional(),
  fullName: z.string().optional(),
  phone: z.string().optional(),
  dateOfBirth: z.string().optional(),
  location: zLocation.optional(),
}

// ... other field groups ...

// Compose full schema
export const users = {
  ...userCoreFields,
  ...userInfoFields,
  // ... other groups
}

export const zUsers = z.object(users)
export const Users = zodTable('users', zUsers)

// Define subsets WITHOUT using .pick()
export const zClerkCreateUserFields = z.object({
  email: z.string(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  tokenId: z.string()
})

export const clerkCreateUserFields = zodToConvex(zClerkCreateUserFields)
```

This approach maintains full type safety while avoiding the type complexity that causes TypeScript to run out of memory.