# Write-side refinement enforcement for codec-paths descriptors

**Status:** approved (design)
**Branch:** `perf/codegen-overhaul` · PR #80 · targets `0.8.0-beta.1`
**Date:** 2026-06-16

## Problem

On `main`/0.7.x the codec-aware `ctx.db` decoded/encoded every document through the
**full** model schema, so zod refinements (`.email()`, `.min()`, `.refine()`, regex, …)
were enforced on both reads and writes.

The codec-paths rework (PR #80) replaced each table's `tableMap` entry with a **minimal**
`z.looseObject` carrying **only codec fields** (to escape the ~150-model memory cliff).
Consequence: `ctx.db.insert/patch/replace` of data **constructed in a handler** (i.e. not
already validated at a `zMutation` args boundary) no longer has its non-codec refinements
checked — **silently**. Args-boundary and declared-returns validation are unaffected
(still full zod).

The descriptor exports `{ doc, insert }`; today both point at the same minimal schema:

```ts
// generate.ts generateModelDescriptors (current)
export default { doc: schema, insert: schema }   // schema = codec-only minimal
```

## Key empirical findings (verified against the worktree's zod v4)

1. **`z.encode()` already enforces** built-in checks **and** custom refinements — it throws
   on invalid `.email()`, `.min()`, and a top-level `.refine()`. The "verify FIRST"
   hypothesis (that encode skips checks, requiring a `parse` in `codec.ts`) is **false**.
2. **`z.looseObject` enforces field-level checks while passing unknown keys through
   untouched.** A loose object holding `{ ts: codec, email: z.string().email() }` throws on
   a bad email yet forwards an unrelated `extra` field verbatim.
3. **The partial (patch) path enforces present refined fields and ignores absent ones.**
   `encodePartialDoc` wraps each shape field in optional and encodes; a present bad field
   throws, an absent one is a no-op.

→ **No change to `codec.ts` / `db.ts` is required.** The regression is purely an *emission*
problem. Putting the refinements back into the `insert` schema makes the existing encode
path enforce them for free. The write path already calls `encodeDoc(schemas.insert, …)`
(insert/replace) and `encodePartialDoc(schemas.insert, …)` (patch).

## Design

### 1. Read/write split in the descriptor emitter

- `doc` → **unchanged**: codec-only minimal (`emitMinimalSchema`). Permissive reads — never
  re-validate refinements on read (one legacy row violating a since-tightened constraint
  would make `db.get()`/`.collect()` throw).
- `insert` → codec fields **plus** non-codec fields carrying **serializable** checks, with
  those checks emitted as source.

### 2. Serializability fork (per check)

Classify each entry of a field's `_zod.def.checks`:

- **Serializable (emit into `insert`):** data-only built-ins. Verified runtime kinds:
  - `min_length` / `max_length` / `length_equals` → `.min(n)` / `.max(n)` / `.length(n)`
  - `greater_than` / `less_than` (+ `inclusive`) → `.gt/.gte/.lt/.lte(value)`
  - `number_format` (`safeint`/`int`) → `.int()`; `multiple_of` → `.multipleOf(n)`
  - `string_format` (email/uuid/url/regex/…): emit the stored `pattern` via
    `.regex(new RegExp(<source>, <flags>))` (reproduces enforcement faithfully and
    deterministically regardless of format name; named methods are a readability nicety,
    not required for correctness).
- **Non-serializable (force fallback):** `check: 'custom'` (closure from `.refine()` /
  `.superRefine()` / `.check(fn)`), any fn-bearing/mutating check (`overwrite`, e.g.
  `.trim()`), and **transforms** (field is a `pipe`, or a top-level `$ZodTransform`).
- **Top-level object refine:** an object whose own `_zod.def.checks` carries a `custom`
  check (the common cross-field `.refine()`). Non-serializable → table-level insert
  fallback.

### 3. Fallback granularity — **insert-only** (confirmed)

A non-serializable refinement/transform makes **only `insert`** import the full model;
`doc` stays codec-only minimal:

```ts
// non-serializable-refinement table
export default { doc: <minimal>, insert: zx.base(Model) /* or Model.schema.insert */ }
```

This preserves read permissiveness **and** read-side weight, and matches the doc/insert
asymmetry the codec-paths design already establishes. The **existing** all-or-nothing
fallback for *codec-unaddressable* tables (codec inside union/record/tuple, or a custom
codec without an importable reference) stays as-is — that genuinely breaks both paths.

### 4. Transforms are out

`.transform()` is one-directional with no inverse; never emit it. A stored model field
using `.transform()` triggers the insert fallback **and** a generate-time warning (point 5).

### 5. Generate-time warning floor

When a model has non-codec refinements or a transform that end up **not** enforced or force
a full-model insert, emit a clear `zodvex generate` warning pointing at the codegen guide,
so the gap/cost is loud. Reuse/extend the existing `fallbacks: { tableName, reason }[]`
reporting channel; add a distinct `insertFallbacks` / warning class so it's not conflated
with the codec-unaddressable fallback.

## Components touched

- `src/public/codegen/generate.ts`
  - new check→source serializer (build on the data already extracted by
    `fingerprintChecks`).
  - `emitInsertSchema` (or an `emitMinimalSchema` mode flag) that, per object field, emits:
    codec ref if codec; else field-with-serializable-checks source if the subtree carries
    serializable refinements; else **omit** (looseObject passthrough preserves weight).
    Returns an `{ unsupported }`-style signal when it hits a non-serializable refinement so
    the caller routes that table's `insert` to the full-model fallback.
  - `generateModelDescriptors`: emit `doc` and `insert` independently; thread the new
    insert-fallback reasons into the output.
- `src/public/cli/commands.ts` — surface the new warnings.
- `src/public/codegen/discover.ts` — only if the classifier needs a discovery-side helper
  (prefer keeping classification in the emitter).
- **No change** to `src/internal/codec.ts` / `src/internal/db.ts`.

## Testing (TDD)

- Write-side refinement **enforced** on insert / patch / replace for in-handler values
  (invalid throws, valid passes) — the headline regression test.
- Reads stay **permissive** (a row violating a refinement still decodes).
- Custom-`.refine()` table falls back cleanly (insert = full model, doc = minimal); enforced
  on insert via the full model.
- Transform field → insert fallback + warning.
- Determinism / byte-stability of emitted descriptors holds (same input → same bytes,
  stable fingerprint).
- Generate-time warning fires for the non-enforced/fallback cases.

## Acceptance gates

- New unit tests above; `bun run test`, `bun run type-check`, `bun run lint` green.
- **Weight gate:** stress harness `--shape=codec-paths` at N=200 and N=600 (zodvex +
  zodvex-mini); per-endpoint weight stays near today's codec-only descriptors and the
  ceiling is unchanged. Bar: `examples/stress-test/results/codec-paths-spike-2026-06-12.md`.
  If a refinement-heavy model forces full-model insert and inflates weight — **stop and
  report** (a finding, not necessarily a blocker).
- Docs: `docs/guide/codegen.md` (models/ section — doc-vs-insert asymmetry + the warning);
  `CHANGELOG.md`; reclassify the plan-doc "Refinement-carrying descriptors" backlog item as
  done.

## Out of scope

- Cutting the release (`bin/release-beta`) — Jake cuts `0.8.0-beta.1` himself.
- Merging to `main`.
- Any change to the args-boundary / declared-returns validation path (already full zod).
