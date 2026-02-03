# Bug: Custom Builder Double-Validates ZodCodec Args

**Date:** 2026-02-02
**Severity:** Critical (breaks all mutations with ZodCodec args)
**Affected:** `zCustomMutationBuilder`, `zCustomQueryBuilder`

## Summary

Custom builders call both `fromConvexJS()` and `argsSchema.safeParse()` on mutation args. For schemas containing `ZodCodec` fields, this causes double-validation where the codec's decode transform runs twice, causing validation to fail.

## Root Cause

In `src/custom.ts` lines 360-362:

```typescript
const decoded = fromConvexJS(rawArgs, argsSchema)   // Step 1: Decodes wire → runtime
const parsed = argsSchema.safeParse(decoded)        // Step 2: Tries to parse AGAIN
```

**The problem:**
1. `fromConvexJS()` walks the schema and calls `.parse()` on each ZodCodec field, converting wire format → runtime format
2. `argsSchema.safeParse(decoded)` then validates the already-decoded data, which tries to run the codec's `.parse()` method again
3. The codec expects wire format input (e.g., `{ value: string, status: 'full' }`), but receives the runtime output (e.g., a class instance)
4. Validation fails because the runtime instance doesn't have the expected wire format properties

## Reproduction

### Minimal Test Case

```typescript
import { z } from 'zod'
import { zodvexCodec, fromConvexJS } from 'zodvex'

// Create a simple codec that transforms wire → runtime
class RuntimeWrapper<T> {
  constructor(public value: T) {}
}

const wrapperCodec = zodvexCodec(
  z.object({ value: z.string() }),           // Wire schema (input)
  z.custom<RuntimeWrapper<string>>(),        // Runtime schema (output)
  {
    decode: (wire) => new RuntimeWrapper(wire.value),
    encode: (runtime) => ({ value: runtime.value }),
  }
)

const schema = z.object({
  name: z.string(),
  wrapped: wrapperCodec.optional(),
})

// Simulate what custom builder does:
const wireArgs = {
  name: 'test',
  wrapped: { value: 'hello' },  // Wire format
}

// Step 1: fromConvexJS decodes wire → runtime
const decoded = fromConvexJS(wireArgs, schema)
console.log('decoded.wrapped:', decoded.wrapped)
// Output: RuntimeWrapper { value: 'hello' }

// Step 2: safeParse on already-decoded data - THIS FAILS
const result = schema.safeParse(decoded)
console.log('success:', result.success)  // false!
console.log('error:', result.error?.format())
// Error: { wrapped: { value: { _errors: ['Expected string, received undefined'] } } }
```

### Real-World Case (from hotpot)

```typescript
import { Patient } from './convex/models/patients'
import { fromConvexJS } from 'zodvex'
import { SensitiveField } from './convex/hotpot/security/sensitiveField'

// Patient.schema.insert has fields like:
// email: sensitive(z.string().email()).optional()
// where sensitive() returns a ZodCodec

const wireArgs = {
  clinicId: 'clinic-1',
  email: { value: 'test@example.com', status: 'full' },
  firstName: { value: 'John', status: 'full' },
}

// Step 1: fromConvexJS correctly decodes
const decoded = fromConvexJS(wireArgs, Patient.schema.insert)
console.log(decoded.email instanceof SensitiveField)  // true ✓

// Step 2: safeParse fails on already-decoded data
const result = Patient.schema.insert.safeParse(decoded)
console.log(result.success)  // false ✗
// Error at email.value: "expected string, received undefined"
// (SensitiveField stores value in WeakMap, not as .value property)
```

## Impact

- **All custom builder mutations with ZodCodec args fail validation**
- Tests using `convex-test` with ZodCodec fields fail
- Production mutations would also fail

## Suggested Fix Options

### Option 1: Remove redundant safeParse (Preferred)

`fromConvexJS()` already calls `.parse()` internally for each field, which includes validation. The subsequent `safeParse()` is redundant and harmful.

```typescript
// Before
const decoded = fromConvexJS(rawArgs, argsSchema)
const parsed = argsSchema.safeParse(decoded)  // Remove this
if (!parsed.success) { ... }
const baseArgs = parsed.data

// After
const decoded = fromConvexJS(rawArgs, argsSchema)  // Already validates during decode
const baseArgs = decoded  // Use decoded directly
```

**Caveat:** Need to ensure `fromConvexJS` throws proper errors on validation failure.

### Option 2: Add flag to skip codec re-validation

If `safeParse` is needed for non-codec validation (refinements, etc.), add a mode that skips codec decode:

```typescript
// In fromConvexJS or a new function
const decoded = fromConvexJS(rawArgs, argsSchema, { validateOnly: false })
const validated = validateWithoutCodecTransform(decoded, argsSchema)
```

### Option 3: Track decoded state

Mark values that have already been decoded to skip them during safeParse:

```typescript
const DECODED = Symbol('zodvex:decoded')
// After fromConvexJS, mark values
decoded[DECODED] = true
// In safeParse wrapper, skip codec transform for marked values
```

## Verification

After fix, these should pass:

```typescript
// Test 1: Simple codec roundtrip
const wireArgs = { name: 'test', wrapped: { value: 'hello' } }
const decoded = fromConvexJS(wireArgs, schema)
// Should NOT throw when used in custom builder

// Test 2: Optional codec field present
const result = await testMutation({ wrapped: { value: 'test' } })
// Should succeed

// Test 3: Optional codec field absent
const result = await testMutation({ name: 'test' })
// Should succeed (field is optional)

// Test 4: Nested codecs in objects/arrays
const schema = z.object({
  items: z.array(z.object({ data: someCodec }))
})
// Should handle nested codec validation correctly
```

## Files to Modify

- `src/custom.ts` - Remove or fix the double-validation
- `__tests__/custom.test.ts` - Add regression tests for ZodCodec args

## Related

- `fromConvexJS()` in `src/codec.ts` - Already handles codec decode
- `zodvexCodec()` in `src/codec.ts` - Creates branded ZodCodec instances
- hotpot's `sensitive()` codec - Real-world use case that exposed this bug
