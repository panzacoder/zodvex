---
name: migrate-to-v0.6
description: Use when upgrading zodvex to v0.6. Automates renames and guides structural migrations interactively.
---

# zodvex v0.6 Migration Skill

You are helping the user migrate their Convex project from zodvex v0.5 to v0.6. Follow these phases in strict order. Do not skip phases. Do not reorder steps within a phase.

## Before You Begin

1. Confirm the project root and the location of the `convex/` directory.
2. Check whether `bun` is available (`which bun`). If yes, use `bunx` instead of `npx` for all commands.
3. Ensure the user has updated zodvex to v0.6 in their `package.json` and installed dependencies.

---

## Phase 1: Automated Renames

Run the codemod to handle mechanical renames (identifier renames, `zid()` to `zx.id()`, import specifier updates):

```bash
npx zodvex migrate ./convex
# or if bun is available:
bunx zodvex migrate ./convex
```

Suggest `--dry-run` first if the user wants to preview changes.

After running, report:
- How many files were scanned and changed
- Any remaining deprecation warnings (these are the symbols that require manual migration in Phase 2)

If there are no remaining deprecation warnings, skip to Phase 3.

---

## Phase 2: Structural Migrations

Work through each step below **in order**. For each step:
1. Search the codebase for the deprecated pattern
2. If no usage is found, say so and move to the next step
3. If usage is found, show the user the current code and the proposed replacement
4. Wait for the user to confirm before applying changes
5. After applying changes, run `tsc --noEmit` to verify no type errors were introduced

### Step 1: Models — `zodTable` to `defineZodModel`

Search for all `zodTable` calls:
```bash
grep -rn 'zodTable' ./convex --include='*.ts' --include='*.tsx'
```

For each occurrence, migrate as follows:

**Before:**
```ts
// convex/schema.ts
import { defineSchema } from 'convex/server'
import { zodTable } from 'zodvex/server'
import { z } from 'zod'

const Users = zodTable('users', {
  name: z.string(),
  email: z.string().email(),
})

export default defineSchema({ users: Users.table })
```

**After:**
```ts
// convex/models.ts (NEW FILE — client-safe, can import in React)
import { defineZodModel } from 'zodvex'
import { z } from 'zod'

export const Users = defineZodModel('users', {
  name: z.string(),
  email: z.string().email(),
})
```

Key changes to apply:
- Create a client-safe models file (e.g., `convex/models.ts`) if one does not already exist
- Move model definitions from `schema.ts` into `models.ts`
- Replace `zodTable(name, fields)` with `defineZodModel(name, fields)`
- Import from `zodvex` instead of `zodvex/server`
- Update property accesses: `.shape` becomes `.fields`
- Remove `.zDoc` usage — use `.schema.doc` instead
- If indexes were defined via `defineTable(...).index(...)` chains after `zodTable`, convert them to chainable methods on the model: `defineZodModel(...).index('byEmail', ['email'])`
- Update all files that imported these models to point to the new location

### Step 2: Schema — `defineSchema` to `defineZodSchema`

Search for Convex `defineSchema` usage in schema files:
```bash
grep -rn 'defineSchema' ./convex --include='*.ts' --include='*.tsx'
```

**Before:**
```ts
// convex/schema.ts
import { defineSchema } from 'convex/server'
export default defineSchema({ users: Users.table })
```

**After:**
```ts
// convex/schema.ts
import { defineZodSchema } from 'zodvex/server'
import { Users } from './models'

export default defineZodSchema({ users: Users })
```

Key changes:
- Replace `defineSchema` from `convex/server` with `defineZodSchema` from `zodvex/server`
- Import models from the models file created in Step 1
- Pass models directly — remove `.table` property accesses (e.g., `Users.table` becomes just `Users`)

### Step 3: Builders — Individual builders to `initZodvex`

Search for deprecated builder imports:
```bash
grep -rn 'zQueryBuilder\|zMutationBuilder\|zActionBuilder\|zCustomQueryBuilder\|zCustomMutationBuilder\|zCustomActionBuilder' ./convex --include='*.ts' --include='*.tsx'
```

**3a. Create the setup file:**

Create `convex/zodvex.ts` (the one-time initialization file):

```ts
import { initZodvex } from 'zodvex/server'
import {
  query, mutation, action,
  internalQuery, internalMutation, internalAction,
} from './_generated/server'
import schema from './schema'

export const { zq, zm, za, ziq, zim, zia } = initZodvex(schema, {
  query, mutation, action,
  internalQuery, internalMutation, internalAction,
})
```

**3b. Update all files that used individual builders:**

**Before:**
```ts
import { query } from './_generated/server'
import { zQueryBuilder } from 'zodvex/server'

const zq = zQueryBuilder(query)

export const getUser = zq({ ... })
```

**After:**
```ts
import { zq } from './zodvex'

export const getUser = zq({ ... })
```

The mapping of old builders to new short names:
| Old builder | New import |
|---|---|
| `zQueryBuilder(query)` | `zq` from `./zodvex` |
| `zMutationBuilder(mutation)` | `zm` from `./zodvex` |
| `zActionBuilder(action)` | `za` from `./zodvex` |
| `zQueryBuilder(internalQuery)` | `ziq` from `./zodvex` |
| `zMutationBuilder(internalMutation)` | `zim` from `./zodvex` |
| `zActionBuilder(internalAction)` | `zia` from `./zodvex` |

**3c. Migrate custom builders:**

**Before:**
```ts
import { zCustomQueryBuilder } from 'zodvex/server'
import { customCtx } from 'convex-helpers/server/customFunctions'

const authedQuery = zCustomQueryBuilder(query, customCtx(async (ctx) => {
  const user = await getAuthUser(ctx)
  return { ctx: { user } }
}))
```

**After:**
```ts
import { customCtx } from 'zodvex/server'
import { zq } from './zodvex'

const authedQuery = zq.withContext(customCtx(async (ctx) => {
  const user = await getAuthUser(ctx)
  return { ctx: { user } }
}))
```

Note: `customCtx` is re-exported from `zodvex/server` — update the import source.

### Step 4: Codec — `convexCodec` to `decodeDoc`/`encodeDoc`

Search for `convexCodec` usage:
```bash
grep -rn 'convexCodec' ./convex --include='*.ts' --include='*.tsx'
```

**Before:**
```ts
import { convexCodec } from 'zodvex'

const codec = convexCodec(UserSchema)
const encoded = codec.encode(user)
const decoded = codec.decode(doc)
```

**After:**
```ts
import { encodeDoc, decodeDoc } from 'zodvex'

const encoded = encodeDoc(UserSchema, user)
const decoded = decodeDoc(UserSchema, doc)
```

Important: If the project now uses `initZodvex` (from Step 3), `ctx.db` already handles encode/decode automatically. In that case, most `convexCodec` usage can simply be removed. Only keep explicit `encodeDoc`/`decodeDoc` calls for escape-hatch scenarios (custom DB layers, manual Convex client calls, code outside of Convex functions).

### Step 5: Cleanup — `mapDateFieldToNumber` to `zx.date()`, removed internals

**5a. Replace date handling:**

Search for `mapDateFieldToNumber` and `z.date()` in schemas:
```bash
grep -rn 'mapDateFieldToNumber\|z\.date()' ./convex --include='*.ts' --include='*.tsx'
```

**Before:**
```ts
import { mapDateFieldToNumber } from 'zodvex'

const schema = z.object({
  createdAt: z.date(),
})
// + manual mapDateFieldToNumber calls at encode/decode boundaries
```

**After:**
```ts
import { zx } from 'zodvex'

const schema = z.object({
  createdAt: zx.date(),
})
// No manual mapping needed — zx.date() handles Date <-> timestamp automatically
```

- Replace `z.date()` with `zx.date()` in all model/schema definitions
- Remove all `mapDateFieldToNumber` calls — they are no longer needed
- `zx.date()` works with `.optional()`, `.nullable()`, and inside arrays/unions

**5b. Remove imports of deleted internals:**

Search for any remaining imports of removed symbols:
```bash
grep -rn 'customFnBuilder\|registryHelpers\|makeUnion\|pick\|formatZodIssues\|handleZodValidationError\|validateReturns\|assertNoNativeZodDate\|isZodUnion\|getUnionOptions\|assertUnionOptions\|createUnionFromOptions\|attachMeta\|readMeta' ./convex --include='*.ts' --include='*.tsx'
```

These symbols have been removed or made internal. For each one found:
| Removed symbol | Replacement |
|---|---|
| `customFnBuilder` | `zCustomQuery` / `zCustomMutation` / `zCustomAction` |
| `registryHelpers` | `zx.id()` — zodvex handles metadata internally |
| `makeUnion` | `zodToConvex` handles unions internally |
| `pick` | Use a local pick utility or lodash |
| `formatZodIssues` | zodvex handles validation internally |
| `handleZodValidationError` | zodvex handles validation internally |
| `validateReturns` | zodvex handles validation internally |
| `assertNoNativeZodDate` | zodvex checks this automatically at registration time |
| `isZodUnion` | `schema instanceof z.ZodUnion` (standard Zod API) |
| `getUnionOptions` | `schema.options` (standard Zod API) |
| `assertUnionOptions` | `schema.options` (standard Zod API) |
| `createUnionFromOptions` | `z.union(options)` (standard Zod API) |
| `attachMeta` / `readMeta` | Internal to zodvex's codegen system — should not be used directly |

---

## Phase 3: Verification

Run all three checks in order:

### 1. Type check
```bash
npx tsc --noEmit
```
Fix any type errors before proceeding.

### 2. Grep for remaining deprecated imports
```bash
grep -rn 'zodTable\|zQueryBuilder\|zMutationBuilder\|zActionBuilder\|zCustomQueryBuilder\|zCustomMutationBuilder\|zCustomActionBuilder\|convexCodec\|mapDateFieldToNumber\|zodDoc\|zodDocOrNull' ./convex --include='*.ts' --include='*.tsx'
```
If any matches remain, go back and address them.

### 3. Run the test suite
```bash
# Detect and run the project's test command
bun test || npm test || npx vitest run
```
If tests fail, investigate and fix before declaring the migration complete.

---

## Completion

When all three verification checks pass, summarize the migration:
- Number of files changed by the codemod (Phase 1)
- Which structural migrations were applied (Phase 2)
- Confirmation that type checking, deprecation grep, and tests all pass (Phase 3)

For detailed reference on any migration pattern, see `docs/migration/v0.6.md` in the zodvex repository.
