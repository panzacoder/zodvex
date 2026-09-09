# Migration compatibility

These notes describe Zodvex's September 2026 implementation. Verify the installed
target: package version alone does not identify an unpublished build. The
[boundary contract](https://github.com/panzacoder/zodvex/blob/1f415c47fa7659c860a3a813cb371020bde53c94/docs/decisions/2026-09-07-boundary-contract.md)
records supported behavior and limitations.

## Dependencies and coexistence

Zodvex requires Zod 4. The current peer range begins at `^4.3.6`; the measured
baseline is **4.5.4**. Installing an old Zod 3 package that happens to expose
`zod/v4` does not satisfy that peer requirement or provide the measured memory
improvements. Record the actual resolved version, not only the package range.

Zod 4 packages include the `zod/v3` compatibility subpath. Before changing the
root dependency, locate existing `from 'zod'` imports and determine which must
continue using Zod 3. Preserve those via `zod/v3` where supported; use `zod/v4`
for migrated code. Check third-party peers and workspace package resolution.
Do not override incompatible peers or cast a Zod 3 schema into a Zod 4 shape.
See [Zod's versioning guidance](https://zod.dev/v4/versioning).

A partial migration can import both Zod runtimes into the same endpoint. Record
that mixed state when interpreting memory; it need not represent the final
Zodvex-only import graph.

In tested helpers `0.1.113`, `convex-helpers/server/zod` re-exports Zod 3 custom
builders backed by `zod/v3`. A mapper supporting multiple Zod versions does not
make its function builders interchangeable. Inspect the customer's installed
implementation, especially on older versions.

## Endpoint-first adoption

The public custom builders work without converting the database schema:

```ts
import { z } from 'zod/v4'
import { zCustomQuery } from 'zodvex/server'
import { NoOp } from 'convex-helpers/server/customFunctions'
import { query } from './_generated/server'

const zq = zCustomQuery(query, NoOp)

export const greeting = zq({
  args: { name: z.string() },
  returns: z.string(),
  handler: (_ctx, { name }) => `Hello ${name}`,
})
```

`NoOp` is appropriate only for an operation that already needs no customization.
For an authenticated operation, preserve its auth/ownership checks and existing
customization. Native Convex validators in customization args can remain native;
Zod-declared customization args also need migration. Preserve consumed/injected
arguments, public/internal visibility and the order of DB wrappers.

This path validates function boundaries and leaves `ctx.db` native. It does not
test Zodvex's modeled database graph. Do not add an empty `defineZodSchema` and
`wrapDb: false` merely to make `initZodvex` accept a native app. Neither
`zodvex migrate` (old Zodvex API renames) nor `codemod` (Full/Mini conversion)
performs this migration.

## Behavior checks that matter

Use representative application values before/after migration; use the current
Zod 3 application as the behavioral reference, not a guessed equivalent schema.

| Area | Check |
| --- | --- |
| Defaults | Zod 4 `.default()` returns an output default without parsing it; `.prefault()` can retain input-default processing. Defaults inside optional object properties can appear where Zod 3 omitted the key. Test absent, explicit undefined and explicit null separately at the applicable boundary. |
| Records/unions | Enum-keyed records become exhaustive in Zod 4; `partialRecord` can express the former partial behavior. Single-argument `record` changes. Preserve discrimination, rejected variants and output shape. |
| Transforms/refinements | Check input and output values, rejection and execution count. Return finalization encodes first and has a unidirectional-transform parsing fallback; do not assume ordinary transforms behave like reversible codecs. Current Zodvex boundaries use synchronous Zod operations. |
| Return hooks | Tested helpers Zod 3 parses returns before `onSuccess`. Current Zodvex runs `onSuccess` before return validation/encoding, with the handler result. Test invalid results and transformed results; a hook may run for an eventual failure. If the app depends on the old order, resolve that explicitly before migrating the affected operation. |
| Empty returns | Helpers normalizes undefined handler results to null before a declared return parse. Use an explicit `return null` for a migrated `returns: z.null()` function. |
| Errors | Error payloads differ. Helpers' `ZodError` payload and Zodvex's contextual errors are not interchangeable. Preserve any client behavior that reads validation errors. |
| Formats/object policies | Zod 4 tightens some formats and changes optionality/error APIs. Check used features against the official migration guide; retain strictness, unknown-key handling and missing-key behavior intentionally. |

See [Zod's migration guide](https://zod.dev/v4/changelog). Preserve existing
authorization tests and add negative cases for the boundaries being changed.
Generated types or direct `_handler` calls alone do not exercise native Convex
argument validators, serialization, authorization setup or database constraints.

## Modeled database adoption

Use `defineZodModel` and `defineZodSchema`, then initialize the six generated
Convex builders through `initZodvex`. See the
[builder guide](https://github.com/panzacoder/zodvex/blob/main/docs/guide/builders.md).
`defineZodSchema` accepts Zodvex model/legacy entries, not arbitrary native
`TableDefinition`s. It has no second schema-options parameter. Native auth or
component tables and non-default schema options therefore need an explicit
integration decision; do not force them through casts or silently drop them.

Retain every table/index name, field wire type and schema policy. `zx.date()`
stores numeric epoch milliseconds; an existing ISO-string field needs a matching
codec if Date behavior is desired. A library migration does not authorize changing
stored representations. Introduce codecs only for behavior the trial requires.

`initZodvex` wraps modeled DB reads/writes; it does not supply application auth.
Apply the existing customizations with `.withContext()` and use `defineContext`
where a shared customization needs inference. `.withContext()` is not a chain
of independent middlewares. With tested helpers `0.1.113`, passing its `customCtx`
adapter directly to `.withContext()` can fail strict TypeScript because its
`extra` parameter is required. Preserve the existing auth helper and use a
contextually typed customization object (or `defineContext`), rather than a cast:

```ts
const authQuery = zq.withContext({
  args: {},
  input: async ctx => ({ ctx: await existingAuthHelper(ctx), args: {} }),
})
```

Adapt this only to a helper that returns the existing added context; retain any
argument processing or hooks from a richer customization. For existing triggers,
`underlyingDb` composes the trigger layer below codecs, where it sees encoded
wire values. Review security
wrappers before changing their position.

Modeled reads parse **full documents**, so existing rows may fail refinements,
receive defaults or undergo transforms even without codecs. Insert/replace encode
runtime values. Object patches encode supplied fields and preserve top-level
undefined for deletion; they do not validate a merged complete document or its
outer refinements. Union patches can require a complete variant. Check get,
query/pagination, insert, replace and relevant patch/unset paths using actual
application values.

Code generation is optional for server validation and modeled DB codecs. Existing
plain Convex clients still send/receive wire values. If the app needs Date/class
values in frontend or outbound function calls, explicitly configure the
appropriate registry/client integration and test that boundary; changing a
server builder alone does not do this.

Ordinary registry/client decoding warns and returns raw wire data by default when
a schema parse fails. `onDecodeError: 'throw'` selects strict failure. Test the
chosen policy before relying on runtime Date/class types after a failed decode;
do not infer a strict client contract from the stricter modeled database path.
