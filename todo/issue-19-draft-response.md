# Draft Response for Issue #19

**To:** @mount-memory
**Re:** https://github.com/panzacoder/zodvex/issues/19

---

Hi @mount-memory! Thanks for reporting this issue with return type inference. Let me help debug this.

## Quick Diagnosis

The `Promise<any>` return type you're seeing is likely caused by one of two things:

1. **Your return schema contains a union or custom type** (triggers an intentional bailout)
2. **TypeScript isn't properly inferring the DataModel** (configuration issue)

## Information Needed

To help diagnose this, could you share:

### 1. Your Full Action Definition

Please share the complete action code, including the `returns` schema:

```typescript
export const yourAction = zAction({
  args: { /* your args */ },
  returns: /* SHOW THIS FULL SCHEMA */,
  handler: async (ctx, args) => {
    // ...
  }
})
```

### 2. Check Your TypeScript Version

```bash
# Run this and share the output
grep '"typescript"' package.json
```

### 3. Verify DataModel Generation

Can you check if your `_generated/dataModel.d.ts` file has this exact line at the bottom?

```typescript
export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
```

Also verify that `convex dev` is running and has generated types successfully.

## Common Causes & Solutions

### Cause 1: Union in Return Schema

If your `returns` schema contains a union, zodvex intentionally falls back to `any` to avoid TypeScript depth errors:

```typescript
// This would cause Promise<any>
returns: z.object({
  status: z.union([z.literal('success'), z.literal('error')]) // ⚠️ Union
})
```

**Workaround:**
```typescript
// Option 1: Use satisfies for manual typing
export const myAction = zAction({
  returns: z.object({ status: z.union([...]) }),
  handler: ...
}) satisfies RegisteredAction<'public', any, Promise<{ status: 'success' | 'error' }>>

// Option 2: Use z.enum() instead (though this also triggers bailout currently)
returns: z.object({
  status: z.enum(['success', 'error'])
})
```

### Cause 2: Using `zid` in Returns

The `zid` helper might also trigger the bailout. Can you check if your return schema uses `zid()`?

```typescript
// This might cause Promise<any>
returns: z.object({
  userId: zid('users') // Might trigger bailout
})
```

### Cause 3: TypeScript Configuration

Make sure your `tsconfig.json` has:

```json
{
  "compilerOptions": {
    "strict": true,
    "skipLibCheck": false
  }
}
```

## Why This Happens

zodvex has an intentional type bailout for complex schemas to prevent TypeScript from hitting instantiation depth limits. From `src/types.ts`:

```typescript
export type InferReturns<R> = R extends z.ZodUnion<any>
  ? any  // Intentional bailout for unions
  : R extends z.ZodCustom<any>
    ? any  // Intentional bailout for custom types
    : R extends z.ZodType<any, any, any>
      ? z.output<R>
      : any
```

This is a known limitation we're working to improve. The bailout is conservative - it triggers for any union or custom type to ensure stability.

## Next Steps

Once you share your return schema, I can:
1. Confirm the exact cause
2. Provide a specific workaround
3. Potentially improve the type inference if this is hitting a false positive

Looking forward to seeing your schema! 🔍

---

**Additional Context:**

Based on your schema.ts (which looks correct), I don't see any obvious issues with your Convex setup. The problem is specifically with zodvex's return type inference, which we can fix once we see your full action definition.
