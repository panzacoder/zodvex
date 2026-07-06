# AI SDK Compatibility

zodvex schemas are fully compatible with [Vercel's AI SDK](https://sdk.vercel.ai/docs), including `zx.id()` for Convex IDs.

## Using with AI SDK

```ts
import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import { zx } from 'zodvex'

const userSchema = z.object({
  id: zx.id('users'),        // ✅ Works with AI SDK
  name: z.string(),
  email: z.string().email(),
  age: z.number().int(),
  teamId: zx.id('teams').optional()
})

const result = await generateObject({
  model: openai('gpt-4'),
  schema: userSchema,
  prompt: 'Generate a sample user profile'
})

// result.object is fully typed and validated
console.log(result.object.id) // Type: GenericId<'users'>
```

## Why It Works

AI SDK requires schemas to be serializable (no `.transform()` or `.brand()`). zodvex's `zx.id()` uses type-level branding instead of runtime transforms, making it compatible:

```ts
// zodvex approach (compatible)
zx.id('users') // String validator with type assertion → GenericId<'users'>

// Not compatible (using transforms)
z.string().transform(s => s as GenericId<'users'>) // ❌ AI SDK rejects
```

Note: `zx.id()` is a typed validator, not a codec. It has no runtime encode/decode — it is purely a type-level assertion over `z.string()`.

## Schemas with Custom Transforms

If you have schemas with custom `.transform()` or `.pipe()`, AI SDK may reject them. For complex transformations, consider:

**Option 1: Separate schemas**
```ts
// For AI SDK (no transforms)
const aiUserSchema = z.object({
  createdAt: z.string() // ISO string
})

// For internal use (with transforms)
const internalUserSchema = z.object({
  createdAt: z.string().transform(s => new Date(s))
})
```

**Option 2: Use zodvex's JSON Schema helper**
```ts
import { zx, toJSONSchema } from 'zodvex'

const schema = z.object({
  userId: zx.id('users'),
  name: z.string()
})

// Automatically handles zx.id() for JSON Schema generation
const jsonSchema = toJSONSchema(schema)
// Use with AI SDK or other JSON Schema consumers
```

The `toJSONSchema` helper automatically handles:
- `zx.id('tableName')` → `{ type: "string", format: "convex-id:tableName" }`
- native `z.date()` → `{ type: "string", format: "date-time" }`
- `zx.date()` → `{ type: "string", format: "date-time" }` (same as native `z.date()`)
- custom codecs (`zx.codec()` / `z.codec()`) → the JSON Schema of the codec's **wire**
  (input) side. JSON Schema describes serialized JSON, and a codec's wire side is by
  definition its JSON shape — a value matching it round-trips through the codec's
  `decode`. To represent a custom codec differently, supply your own override (below);
  it runs before zodvex's.

For custom overrides, use `zodvexJSONSchemaOverride` directly:
```ts
import { zodvexJSONSchemaOverride, composeOverrides } from 'zodvex'

const jsonSchema = z.toJSONSchema(schema, {
  unrepresentable: 'any',
  override: composeOverrides(myCustomOverride, zodvexJSONSchemaOverride)
})
```
