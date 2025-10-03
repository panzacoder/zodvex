# zodvex

#### [Zod](https://zod.dev/) + [Convex](https://www.convex.dev/)

Type-safe Convex functions with Zod schemas. Preserve Convex's optional/nullable semantics while leveraging Zod's powerful validation.

> Heavily inspired by [convex-helpers](https://github.com/get-convex/convex-helpers). Built on top of their excellent utilities.

## 📦 Installation

```bash
npm install zodvex zod convex convex-helpers
```

```bash
pnpm add zodvex zod convex convex-helpers
```

```bash
yarn add zodvex zod convex convex-helpers
```

```bash
bun add zodvex zod convex convex-helpers
```

**Peer dependencies:**

- `zod` (v4)
- `convex` (>= 1.27)
- `convex-helpers` (>= 0.1.101-alpha.1)

## 🚀 Quick Start

### 1. Define a Zod schema and create type-safe Convex functions

```ts
// convex/users.ts
import { z } from "zod";
import { query, mutation } from "./_generated/server";
import { zQuery, zMutation } from "zodvex";

// Define your schema
const UserInput = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().optional(),
});

// Create type-safe queries
export const getUser = zQuery(
  query,
  { id: z.string() },
  async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
);

// Create type-safe mutations
export const createUser = zMutation(mutation, UserInput, async (ctx, user) => {
  // `user` is fully typed and validated!
  return await ctx.db.insert("users", user);
});
```

### 2. Use with Convex schemas

```ts
// convex/schema.ts
import { defineSchema } from "convex/server";
import { z } from "zod";
import { zodTable } from "zodvex";

// Define a table from a plain object shape
const usersShape = {
  name: z.string(),
  email: z.string().email(),
  age: z.number().optional(), // → v.optional(v.float64())
  deletedAt: z.date().nullable(), // → v.union(v.float64(), v.null())
};

export const Users = zodTable("users", usersShape);

// Use in your Convex schema
export default defineSchema({
  users: Users.table.index("by_email", ["email"]).searchIndex("search_name", {
    searchField: "name",
  }),
});
```

## ✨ Features

### Why zodvex?

- **Correct optional/nullable semantics**: Preserves Convex's distinction between optional and nullable fields
  - `.optional()` → `v.optional(T)` (field can be omitted)
  - `.nullable()` → `v.union(T, v.null())` (field required but can be null)
  - `.optional().nullable()` → `v.optional(v.union(T, v.null()))` (can be omitted or null)
- **Type-safe function wrappers**: Full TypeScript inference for inputs and outputs
- **Date handling**: Automatic conversion between JavaScript `Date` objects and Convex timestamps
- **CRUD scaffolding**: Generate complete CRUD operations from a single schema

### Supported Types

This library intentionally supports only Zod types that map cleanly to Convex validators. Anything outside this list is unsupported (or best-effort with caveats).

- Primitives: `z.string()`, `z.number()` → `v.float64()`, `z.boolean()`, `z.null()`
- Date: `z.date()` → `v.float64()` (timestamp), encoded/decoded automatically
- Literals: `z.literal(x)` → `v.literal(x)`
- Enums: `z.enum([...])` → `v.union(v.literal(...))`
- Arrays: `z.array(T)` → `v.array(T')`
- Objects: `z.object({...})` → `v.object({...})`
- Records: `z.record(T)` or `z.record(z.string(), T)` → `v.record(v.string(), T')` (string keys only)
- Unions: `z.union([...])` (members must be supported types)
- Optional/nullable wrappers: `.optional()` → `v.optional(T')`, `.nullable()` → `v.union(T', v.null())`
- Convex IDs: `zid('table')` → `v.id('table')`

Unsupported or partial (explicitly out-of-scope):

- Tuples (fixed-length) — Convex has no fixed-length tuple validator; mapping would be lossy
- Intersections — combining object shapes widens overlapping fields; not equivalent to true intersection
- Transforms/effects/pipelines — not used for validator mapping; if you use them, conversions happen at runtime only
- Lazy, function, promise, set, map, symbol, branded/readonly, NaN/catch — unsupported

Note: `z.bigint()` → `v.int64()` is recognized for validator mapping but currently has no special runtime encode/decode; prefer numbers where possible.

## 📚 API Reference

### Mapping Helpers

Convert Zod schemas to Convex validators:

```ts
import { z } from "zod";
import { zodToConvex, zodToConvexFields, pickShape, safePick } from "zodvex";

// Convert a single Zod type to a Convex validator
const validator = zodToConvex(z.string().optional());
// → v.optional(v.string())

// Convert a Zod object shape to Convex field validators
const fields = zodToConvexFields({
  name: z.string(),
  age: z.number().nullable(),
});
// → { name: v.string(), age: v.union(v.float64(), v.null()) }

// Safe picking from large schemas
// IMPORTANT: Avoid Zod's .pick() on large schemas (30+ fields) as it can cause
// TypeScript instantiation depth errors. Use pickShape/safePick instead.

const User = z.object({
  id: z.string(),
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  createdAt: z.date().nullable(),
});

// ❌ DON'T use Zod's .pick() on large schemas (type instantiation issues)
// const Clerk = User.pick({ email: true, firstName: true, lastName: true });

// ✅ DO use pickShape to extract a plain object shape
const clerkShape = pickShape(User, ["email", "firstName", "lastName"]);
// Use directly in wrappers or build a new z.object()
const Clerk = z.object(clerkShape);

// Alternative: safePick builds the z.object() for you
const ClerkAlt = safePick(User, { email: true, firstName: true, lastName: true });
// Both Clerk and ClerkAlt are equivalent - use whichever is more readable
```

### Function Wrappers

Type-safe wrappers for Convex functions:

```ts
import { z } from "zod";
import { query, mutation, action } from "./_generated/server";
import { zQuery, zMutation, zAction } from "zodvex";

// Query with validated input and optional return validation
export const getById = zQuery(
  query,
  { id: z.string() },
  async (ctx, { id }) => ctx.db.get(id),
  {
    returns: z.object({
      name: z.string(),
      createdAt: z.date(),
    }),
  },
);

// Mutation with Zod object
export const updateUser = zMutation(
  mutation,
  z.object({
    id: z.string(),
    name: z.string().min(1),
  }),
  async (ctx, { id, name }) => ctx.db.patch(id, { name }),
);

// Action with single value (normalizes to { value })
export const sendEmail = zAction(
  action,
  z.string().email(),
  async (ctx, { value: email }) => {
    // Send email to the address
  },
);

// Internal functions also supported
import { zInternalQuery, zInternalMutation, zInternalAction } from "zodvex";

// Handler return typing
// When `returns` is provided, your handler must return z.input<typeof returns>
// (domain values like Date). zodvex validates and encodes to Convex Values for you.
```

#### Return Typing + Helpers

Handlers should return domain values shaped by your `returns` schema. zodvex validates and encodes them to Convex Values for you. For common patterns:

```ts
import { z } from "zod";
import { zQuery, zodTable, returnsAs } from "zodvex";
import { query } from "./_generated/server";

// Table with doc helpers
export const Users = zodTable("users", {
  name: z.string(),
  createdAt: z.date()
});

// 1) Return full docs, strongly typed
export const listUsers = zQuery(
  query,
  {},
  async (ctx) => {
    const rows = await ctx.db.query("users").collect();
    // No cast needed — handler returns domain values; wrapper encodes to Convex Values
    return rows;
  },
  { returns: Users.docArray }
);

// 2) Return a custom shape (with Dates)
export const createdBounds = zQuery(
  query,
  {},
  async (ctx) => {
    const first = await ctx.db.query("users").order("asc").first();
    const last = await ctx.db.query("users").order("desc").first();
    return { first: first?.createdAt ?? null, last: last?.createdAt ?? null };
  },
  { returns: z.object({ first: z.date().nullable(), last: z.date().nullable() }) }
);

// 3) In tricky inference spots, use a typed identity
export const listUsersOk = zQuery(
  query,
  {},
  async (ctx) => {
    const rows = await ctx.db.query("users").collect();
    return returnsAs<typeof Users.docArray>()(rows);
  },
  { returns: Users.docArray }
);
```

### Codecs

Convert between Zod-shaped data and Convex-safe JSON:

```ts
import { convexCodec } from "zodvex";
import { z } from "zod";

const UserSchema = z.object({
  name: z.string(),
  birthday: z.date().optional(),
  metadata: z.record(z.string()),
});

const codec = convexCodec(UserSchema);

// Get Convex validators for table definition
const validators = codec.toConvexSchema();

// Encode: Zod data → Convex JSON (Date → timestamp, omit undefined)
const encoded = codec.encode({
  name: "Alice",
  birthday: new Date("1990-01-01"),
  metadata: { role: "admin" },
});
// → { name: 'Alice', birthday: 631152000000, metadata: { role: 'admin' } }

// Decode: Convex JSON → Zod data (timestamp → Date)
const decoded = codec.decode(encoded);
// → { name: 'Alice', birthday: Date('1990-01-01'), metadata: { role: 'admin' } }

// Create sub-codecs (ZodObject only)
const nameCodec = codec.pick({ name: true });
```

### Table Helpers

Define Convex tables from Zod schemas. `zodTable` accepts a **plain object shape** for best type inference:

```ts
import { z } from "zod";
import { zodTable, zid } from "zodvex";
import { defineSchema } from "convex/server";

// Define your schema as a plain object
const postShape = {
  title: z.string(),
  content: z.string(),
  authorId: zid("users"), // Convex ID reference
  published: z.boolean().default(false),
  tags: z.array(z.string()).optional(),
};

// Create table helper - pass the plain object shape
export const Posts = zodTable("posts", postShape);

// Access properties
Posts.table;    // → Table definition for defineSchema
Posts.shape;    // → Original plain object shape
Posts.zDoc;     // → ZodObject with _id and _creationTime system fields
Posts.docArray; // → z.array(zDoc) for return type validation

// Use in schema.ts
export default defineSchema({
  posts: Posts.table
    .index("by_author", ["authorId"])
    .index("by_published", ["published"]),
});

// Use docArray for return types
export const listPosts = zQuery(
  query,
  {},
  async (ctx) => ctx.db.query("posts").collect(),
  { returns: Posts.docArray }
);
```

#### Working with Large Schemas

For large schemas (30+ fields), the plain object pattern is recommended:

```ts
// Define as plain object for better maintainability
export const users = {
  // Meta
  tokenId: z.string(),
  type: z.literal("member"),
  isAdmin: z.boolean(),

  // User info
  email: z.string(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phone: z.string().optional(),

  // References
  favoriteUsers: z.array(zid("users")).optional(),
  activeDancerId: zid("dancers").optional(),
  // ... 40+ more fields
};

// Create table
export const Users = zodTable("users", users);

// Extract subsets without Zod's .pick() to avoid type complexity
const zClerkFields = z.object(pickShape(users, ["email", "firstName", "lastName", "tokenId"]));
// Use zClerkFields in function wrappers or validators
```

## 🔧 Advanced Usage

### Builder Pattern for Reusable Function Creators

For projects with many functions, create reusable builders instead of repeating the base builder.
Builders use Convex's native `{ args, handler, returns }` object syntax:

```ts
import { query, mutation } from "./_generated/server";
import { createQueryBuilder, createMutationBuilder } from "zodvex";

// Create reusable builders
export const zq = createQueryBuilder(query);
export const zm = createMutationBuilder(mutation);

// Use them with Convex-style object syntax
export const getUser = zq({
  args: { id: z.string() },
  handler: async (ctx, { id }) => {
    return ctx.db.get(id);
  }
});

export const updateUser = zm({
  args: { id: z.string(), name: z.string() },
  handler: async (ctx, { id, name }) => {
    return ctx.db.patch(id, { name });
  }
});
```

### Custom Context with Middleware

Combine with convex-helpers' customQuery/customMutation/customAction for middleware:

```ts
import { customQuery, customMutation } from "convex-helpers/server/customFunctions";
import { createQueryBuilder, createMutationBuilder } from "zodvex";
import { query, mutation } from "./_generated/server";

// Create authenticated builders
const _authQuery = customQuery(query, {
  input: async (ctx) => {
    const user = await getUserOrThrow(ctx);
    return { user };
  }
});
export const authQuery = createQueryBuilder(_authQuery);

const _authMutation = customMutation(mutation, {
  input: async (ctx) => {
    const user = await getUserOrThrow(ctx);
    return { user };
  }
});
export const authMutation = createMutationBuilder(_authMutation);

// Use them with automatic type-safe context
export const getProfile = authQuery({
  args: {},
  handler: async (ctx) => {
    // ctx.user is automatically available and typed!
    return ctx.db.query("users").filter(q => q.eq(q.field("_id"), ctx.user._id)).first();
  }
});
```

### Working with Dates

```ts
// Dates are automatically converted to timestamps
const eventShape = {
  title: z.string(),
  startDate: z.date(),
  endDate: z.date().nullable(),
};

const Events = zodTable("events", eventShape);

// In mutations - Date objects work seamlessly
export const createEvent = zMutation(
  mutation,
  z.object(eventShape),
  async (ctx, event) => {
    // event.startDate is a Date object
    // It's automatically converted to timestamp for storage
    return ctx.db.insert("events", event);
  },
);
```

### Using Convex IDs

```ts
import { zid } from "zodvex";

const CommentSchema = z.object({
  text: z.string(),
  postId: zid("posts"), // Reference to posts table
  authorId: zid("users"), // Reference to users table
  parentId: zid("comments").optional(), // Self-reference
});
```

## ⚙️ Behavior & Semantics

### Type Mappings

| Zod Type          | Convex Validator          |
| ----------------- | ------------------------- |
| `z.string()`      | `v.string()`              |
| `z.number()`      | `v.float64()`             |
| `z.bigint()`      | `v.int64()`               |
| `z.boolean()`     | `v.boolean()`             |
| `z.date()`        | `v.float64()` (timestamp) |
| `z.null()`        | `v.null()`                |
| `z.array(T)`      | `v.array(T)`              |
| `z.object({...})` | `v.object({...})`         |
| `z.record(T)`     | `v.record(v.string(), T)` |
| `z.union([...])`  | `v.union(...)`            |
| `z.literal(x)`    | `v.literal(x)`            |
| `z.enum([...])`   | `v.union(literals...)`    |
| `z.optional(T)`   | `v.optional(T)`           |
| `z.nullable(T)`   | `v.union(T, v.null())`    |

### Important Notes

- **Defaults**: Zod defaults imply optional at the Convex schema level. Apply defaults in your application code.
- **Numbers**: `z.number()` maps to `v.float64()`. For integers, use `z.bigint()` → `v.int64()`.
- **Transforms**: Zod transforms (`.transform()`, `.refine()`) are not supported in schema mapping and fall back to `v.any()`.
 - **Return encoding**: Return values are always encoded to Convex Values. When `returns` is specified, values are validated and then encoded according to the schema; without `returns`, values are still encoded (e.g., Date → timestamp) for runtime safety.

### Runtime Conversion Consistency

zodvex uses an internal base-type codec registry to keep validator mapping and runtime value conversion aligned (e.g., `Date` ↔ timestamp). Composite types (arrays, objects, records, unions, optional/nullable) are composed from these base entries.

## 📝 Compatibility

- **Zod**: v4 only (uses public v4 APIs)
- **Convex**: >= 1.27
- **TypeScript**: Full type inference support

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT

---

Built with ❤️ on top of [convex-helpers](https://github.com/get-convex/convex-helpers)
