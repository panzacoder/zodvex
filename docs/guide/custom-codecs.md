# Custom Codecs

zodvex provides a codec system for transforming data between wire format (stored in Convex) and runtime format (used in your code). See the [README](../../README.md) for a full overview of zodvex.

## Primary API: `zx.codec()`

Use `zx.codec()` to create custom codecs that automatically work with validator generation and runtime encoding/decoding.

```ts
import { z } from 'zod'
import { zx, type ZodvexCodec } from 'zodvex'

type EncryptedCodec = ZodvexCodec<
  z.ZodObject<{ encrypted: z.ZodString }>,
  z.ZodCustom<string>
>

function encryptedString(): EncryptedCodec {
  return zx.codec(
    z.object({ encrypted: z.string() }),  // Wire schema (stored in Convex)
    z.custom<string>(() => true),          // Runtime schema (used in code)
    {
      decode: (wire) => decrypt(wire.encrypted),
      encode: (value) => ({ encrypted: encrypt(value) })
    }
  )
}

// Use in your schema
const userShape = {
  name: z.string(),
  ssn: encryptedString()  // Automatically encrypted/decrypted
}
```

## Two Things Called "Brand" (Disambiguation)

zodvex uses the word *brand* for two unrelated mechanisms — don't conflate them:

1. **The type-level `ZodvexCodec` brand** (shown above). A TypeScript-only marker on the type
   returned by `zx.codec()` that lets zodvex extract the **wire schema** through an opaque
   type alias like `EncryptedCodec`. It has no runtime presence and exists so validator
   generation still sees the wire shape when your codec hides behind a named factory type.

2. **The runtime provenance brand** — the optional fourth argument
   `zx.codec(wire, runtime, transforms, { brand: 'myLib/encrypted' })`. A runtime tag
   (stored non-enumerable, surviving `.optional()`/`.nullable()`) that **codegen** uses to
   match a codec in your function definitions to the same codec on the client, when it can't
   match by object identity. It does nothing at the type level.

Rule of thumb: factory behind a **type alias** → you're relying on brand (1); codec that must
be **matched by codegen** across module boundaries → give it brand (2). They compose freely.

## When to Use Custom Codecs

- **Encrypted data**: Encrypt/decrypt fields before storage
- **Complex objects**: Serialize/deserialize custom class instances
- **Wire format transformations**: Convert between API formats and internal representations

## Automatic Codec Detection

zodvex automatically detects codecs created with `zx.codec()` and native `z.codec()`. No manual registration is required:

```ts
import { z } from 'zod'
import { zodToConvex } from 'zodvex'

const codec = encryptedString()

// Validator generation — uses wire schema automatically
const validator = zodToConvex(codec)
// → v.object({ encrypted: v.string() })

// Runtime encoding — use Zod's native z.encode()
const convexValue = z.encode(codec, 'my-secret')
// → { encrypted: '<encrypted-value>' }

// Runtime decoding — use schema.parse()
const runtimeValue = codec.parse({ encrypted: '<encrypted-value>' })
// → 'my-secret'
```

## Nested Codecs

Codecs work correctly when nested inside object schemas. All fields are automatically encoded/decoded using Zod's native functions:

```ts
const schema = z.object({
  id: z.string(),
  secret: encryptedString(),  // Custom codec
  createdAt: zx.date()        // Built-in zx.date() codec
})

// Encode for storage
const encoded = z.encode(schema, {
  id: 'user-123',
  secret: 'password',
  createdAt: new Date()
})
// → { id: 'user-123', secret: { encrypted: '...' }, createdAt: 1234567890 }

// Decode from storage
const decoded = schema.parse(encoded)
// → { id: 'user-123', secret: 'password', createdAt: Date(...) }
```

## `zx.codec()` vs `z.codec()`

Prefer `zx.codec()` over native `z.codec()` for better type inference when using type aliases:

```ts
// ❌ Type alias loses codec structure
type MyCodec = z.ZodType<string>
const codec: MyCodec = z.codec(wire, runtime, transforms)
zodToConvex(codec)  // → v.any() (type lost)

// ✅ ZodvexCodec preserves wire schema type
type MyCodec = ZodvexCodec<WireSchema, RuntimeSchema>
const codec: MyCodec = zx.codec(wire, runtime, transforms)
zodToConvex(codec)  // → v.object({ ... }) (correct inference)
```

Both work at runtime — the difference is TypeScript type inference precision. When you don't use a type alias (e.g., `const codec = zx.codec(...)` with inferred type), they behave identically.

## Escape Hatches: `decodeDoc` / `encodeDoc`

For manual control over encoding/decoding outside of the automatic schema pipeline, use `decodeDoc` and `encodeDoc`:

```ts
import { decodeDoc, encodeDoc, zx } from 'zodvex'
import { UserModel } from './models/user'

// Decode a raw Convex document to runtime types
const rawDoc = await ctx.db.get(id) // wire format from Convex
const user = decodeDoc(zx.doc(UserModel), rawDoc) // runtime format (Dates, etc.)

// Encode runtime data back to wire format for insert/replace
const wireData = encodeDoc(zx.base(UserModel), user) // wire format (timestamps, etc.)
await ctx.db.insert('users', wireData)
```

Both functions take a Zod schema, not a model directly. Use `zx.doc(UserModel)` for decoding reads (includes `_id`, `_creationTime`), `zx.base(UserModel)` (the user fields) for encoding writes.

Use these when building custom DB wrappers or working outside of `initZodvex` (which handles codec encode/decode automatically).

## Legacy: `convexCodec`

> **Deprecated:** `convexCodec()` is deprecated. Use `initZodvex` for automatic codec handling at all boundaries, or `decodeDoc`/`encodeDoc` for manual one-off conversions.

`convexCodec` is still exported for backwards compatibility but will be removed in a future major version:

```ts
import { convexCodec } from 'zodvex'

const UserSchema = z.object({
  name: z.string(),
  birthday: zx.date().optional()
})

const codec = convexCodec(UserSchema)

// Encode: Date → timestamp, strip undefined
const encoded = codec.encode({
  name: 'Alice',
  birthday: new Date('1990-01-01')
})
// → { name: 'Alice', birthday: 631152000000 }

// Decode: timestamp → Date
const decoded = codec.decode(encoded)
// → { name: 'Alice', birthday: Date('1990-01-01') }
```

> **Note:** `convexCodec` throws an error if the schema contains native `z.date()`. Use `zx.date()` instead.

## Built-in Codecs

zodvex provides two built-in codecs in the `zx` namespace:

- **`zx.date()`** — transforms `Date` ↔ `number` (Unix timestamp). See [zx Namespace](./zx-namespace.md).
- **`zx.codec(wire, runtime, transforms)`** — create your own codec (documented above).

`zx.id()` is NOT a codec — it is a typed validator with no wire transformation. See [zx Namespace](./zx-namespace.md) for details.
