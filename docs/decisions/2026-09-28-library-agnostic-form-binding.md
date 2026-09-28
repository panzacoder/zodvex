# Decision: Library-Agnostic Form Binding via an Args-Schema Accessor

**Date:** 2026-09-28
**Status:** Accepted
**Context:** Schema-driven UI from function args ([#153](https://github.com/panzacoder/zodvex/issues/153)); closes the question left open by #45 (`zodvex.config.ts` form-resolver codegen), closed unrebased the same day
**Supersedes (in part):** `2026-03-02-form-resolver-naming.md`, section 2 ("Codegen pre-binds resolvers")

---

## Decision

Form binding is library-agnostic. The generated client (or a core primitive it re-exports)
exposes **one accessor** that returns a function's args schema from the registry given a
function reference:

```ts
import { argsSchema } from './_zodvex/client'
import { api } from './_generated/api'

const schema = argsSchema(api.patients.create) // illustrative name; returns the registry's args schema
```

Consumers pass that schema to whatever resolver their form library already provides —
`zodResolver(schema)` for React Hook Form, `validators: { onChange: schema }` for TanStack
Form, and so on. zodvex does not generate per-library resolvers.

- **React Hook Form and TanStack Form** are the priority integrations to document.
- **Mantine is not a priority.** The project has no attachment to it and rarely uses it.
  `zodvex/form/mantine` stays as a manual-bind primitive (`mantineResolver(registry, ref)`).
- **No `zodvex.config.ts`** and no per-library codegen plugins for now. A config file is
  deferred until a second codegen option needs one.
- **No auto-detection of form libraries**, ever. The `require.resolve`-based detection
  false-positived when Bun auto-installed optional peer deps and poisoned generated files
  (`docs/planning/opt-in-client-library-codegen.md`); explicit imports are the only opt-in.

## Reasoning

**The registry copy is not faithful enough to bind blindly.** `_zodvex/api.js` is a
shape-only copy: `zodToSource` drops checks, defaults, `describe` and `meta`. Models and
exported codecs are the exception, referenced by import at full fidelity. A pre-bound
resolver would validate against the lossy copy and silently accept what the server rejects.
The accessor makes the source explicit: it hands back whatever the registry holds, and the
rule from #153 governs what that is — shape-only args work through the copy; anything the
client must see faithfully must be an importable export from a client-safe module. Emitter
fidelity for the closure-free surface (#153, item 1) raises the floor; it does not change
the accessor.

**One accessor beats N plugins.** Every form library already ships a Zod resolver. The
only zodvex-specific step is "find the schema for this function reference", which is one
function regardless of library. A plugin per library would duplicate each library's own
adapter, add a codegen surface to maintain per library, and require a config mechanism to
select them.

**No config file yet.** A `zodvex.config.ts` is justified when two or more codegen options
need it. With the accessor there is none, so adding the file would be speculative surface.

**No auto-detection.** The false-positive incident is the whole argument: generated files
must never import a library because it happened to be resolvable.

## What this supersedes in the 2026-03-02 decision

- **Replaced:** section 2, "Codegen pre-binds resolvers in `_zodvex/client.ts`". Codegen
  does not emit `mantineResolver = (ref) => _mantineResolver(zodvexRegistry, ref)` or any
  per-library binding. It emits the args-schema accessor; binding to a resolver is the
  consumer's line of code.
- **Stands:** section 1, the `{library}Resolver` naming convention and the
  `zodvex/form/{library}` entry-point placement. Any library-specific helper that does get
  added follows it.
- **Stands:** `zodvex/form/mantine` and `mantineResolver(registry, ref)` as a manual-bind
  primitive. It is not removed and not promoted.

## Alternatives Considered

**Per-library codegen plugins behind `zodvex.config.ts` (#45).** Explicit opt-in fixed the
auto-detect bug, but it still generates one adapter per library and needs a config file
whose only consumer would have been this feature.

**Pre-binding the accessor to a specific resolver.** Picks a winner among form libraries
for no gain; the resolver call is one line in consumer code.

**Auto-detecting installed form libraries.** Dropped for good; see above.

## Consequences

- Sequenced after emitter fidelity in #153, since binding a form to a lossy schema gives
  wrong answers; `introspect()` and defaults helpers follow for the same reason.
- Guides to write once the accessor lands: React Hook Form and TanStack Form binding,
  each a few lines around the accessor.
- `docs/roadmap.md` ("Library-agnostic form binding") and
  `docs/planning/opt-in-client-library-codegen.md` carry the updated status.
