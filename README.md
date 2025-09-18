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

// Define a table from a Zod schema
const UsersSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  age: z.number().optional(), // → v.optional(v.float64())
  deletedAt: z.date().nullable(), // → v.union(v.float64(), v.null())
});

export const Users = zodTable("users", UsersSchema);

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
import { zodToConvex, zodToConvexFields } from "zodvex";

// Convert a single Zod type to a Convex validator
const validator = zodToConvex(z.string().optional());
// → v.optional(v.string())

// Convert a Zod object shape to Convex field validators
const fields = zodToConvexFields({
  name: z.string(),
  age: z.number().nullable(),
});
// → { name: v.string(), age: v.union(v.float64(), v.null()) }
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

Define Convex tables from Zod schemas:

```ts
import { z } from "zod";
import { zodTable } from "zodvex";
import { defineSchema } from "convex/server";

// Define your schema
const PostSchema = z.object({
  title: z.string(),
  content: z.string(),
  authorId: zid("users"), // Convex ID reference
  published: z.boolean().default(false),
  tags: z.array(z.string()).optional(),
});

// Create table helper
export const Posts = zodTable("posts", PostSchema);

// Access properties
Posts.table; // → Table definition for defineSchema
Posts.schema; // → Original Zod schema
Posts.codec; // → ConvexCodec instance

// Use in schema.ts
export default defineSchema({
  posts: Posts.table
    .index("by_author", ["authorId"])
    .index("by_published", ["published"]),
});
```

### CRUD Operations

Generate complete CRUD operations from a table:

```ts
import { zCrud, zid } from "zodvex";
import { query, mutation } from "./_generated/server";
import { Posts } from "./schemas/posts";

// Generate CRUD operations
export const postsCrud = zCrud(Posts, query, mutation);

// Now you have:
// postsCrud.create   - Create a new post
// postsCrud.read     - Read a post by ID
// postsCrud.paginate - Paginate through posts
// postsCrud.update   - Update a post by ID
// postsCrud.destroy  - Delete a post by ID

// Each operation is fully typed based on your schema!
```

## 🔧 Advanced Usage

### Custom Validators with Zod

```ts
import { z } from "zod";
import { zCustomQuery } from "zodvex";
import { customQuery } from "convex-helpers/server/customFunctions";

// Use with custom function builders
export const authenticatedQuery = zCustomQuery(
  customQuery(query, {
    args: { sessionId: v.string() },
    input: async (ctx, { sessionId }) => {
      const user = await getUser(ctx, sessionId);
      return { user };
    },
  }),
  { postId: z.string() },
  async (ctx, { postId }) => {
    // ctx.user is available from custom input
    return ctx.db.get(postId);
  },
);
```

### Working with Dates

```ts
// Dates are automatically converted
const EventSchema = z.object({
  title: z.string(),
  startDate: z.date(),
  endDate: z.date().nullable(),
});

const Event = zodTable("events", EventSchema);

// In mutations - Date objects work seamlessly
export const createEvent = zMutation(
  mutation,
  EventSchema,
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
