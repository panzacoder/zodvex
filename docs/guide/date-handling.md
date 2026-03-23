# Date Handling

Use `zx.date()` for explicit, type-safe date handling. This codec transforms between JavaScript `Date` objects and Convex timestamps (stored as `v.float64()`).

## Using zx.date() (Recommended)

```ts
import { zx } from 'zodvex'

const eventShape = {
  title: z.string(),
  startDate: zx.date(),
  endDate: zx.date().nullable(),
  createdAt: zx.date().optional()
}

export const Events = defineZodModel('events', eventShape)

// In your function - dates work seamlessly
export const createEvent = zm({
  args: eventShape,
  handler: async (ctx, { startDate, endDate, title }) => {
    // startDate and endDate are already Date objects!
    console.log(startDate.toISOString()) // ✅ Works

    // Automatically converted to timestamps for storage
    return await ctx.db.insert('events', { title, startDate, endDate })
  }
})

// On the frontend - just pass Date objects
const createEvent = useMutation(api.events.createEvent)
await createEvent({
  title: 'My Event',
  startDate: new Date('2024-01-01'),
  endDate: new Date('2024-01-02')
})
// ✅ Automatically encoded to timestamps
```

**How it works:**
- **Args**: Timestamps from client → decoded to `Date` objects via codec
- **Returns**: `Date` objects from handler → encoded to timestamps via codec
- **Storage**: Dates are stored as `v.float64()` (Convex doesn't have a native Date type)

**Why `zx.date()` instead of `z.date()`?**

The `zx.date()` codec makes the transformation explicit — you know at a glance that wire format conversion is happening. This avoids "magic" behavior that can be confusing.

### Automatic Codec Handling with initZodvex

When using `initZodvex`, codec encoding and decoding at the DB layer is handled automatically. You don't need to manually call encode/decode functions — dates round-trip as `Date` objects at every boundary.

## Deprecated: mapDateFieldToNumber

`mapDateFieldToNumber` is still exported for backwards compatibility but is **deprecated**. Use `zx.date()` instead:

```ts
// ❌ Deprecated — maps a z.date() field to z.number()
import { mapDateFieldToNumber } from 'zodvex'
const field = mapDateFieldToNumber(z.date()) // returns z.number()

// ✅ Use zx.date() in your schema — encoding is automatic
const schema = z.object({
  createdAt: zx.date()
})
```

## Alternative: Manual String Dates

If you prefer working with ISO strings instead of Date objects, use `z.string()`:

```ts
// Using z.string() means NO automatic conversion
const schema = {
  birthday: z.string() // Stored as ISO string
}

export const updateUser = zm({
  args: schema,
  handler: async (ctx, { birthday }) => {
    // birthday is a string, you must manually parse
    const date = new Date(birthday) // Manual conversion
    await ctx.db.insert('users', { birthday })
  }
})
```

**When to use which:**
- ✅ **`zx.date()`** — When you want automatic conversion and type-safe Date objects (recommended)
- ⚠️ **`z.string()`** — When you need ISO strings for display/formatting (requires manual parsing)

## z.date() Is Not Supported

Using native `z.date()` will throw an error at runtime with guidance to migrate:

```ts
// ❌ This will throw an error
const schema = z.object({
  createdAt: z.date()  // Error: z.date() is not compatible with Convex
})

// ✅ Use zx.date() instead
const schema = z.object({
  createdAt: zx.date()  // Works correctly
})
```

**Why?** Convex stores dates as timestamps (numbers), which native `z.date()` cannot parse directly. The `zx.date()` codec handles the timestamp ↔ Date conversion automatically.
