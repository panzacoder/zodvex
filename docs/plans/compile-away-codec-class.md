# Compile-away via pure-JS codec classes — design SKETCH (not a plan)

Status: SKETCH (2026-06-15). Exploratory. Captures the idea + the design
problem + the constraints so it's here when/if we decide to revisit
compile-away. **Not scheduled.** The shipped, parity-proven answer is
codec-paths (`codec-paths-productionization.md`); this is the endgame that a
Convex build-time hook would unlock (platform ask #2 in
`docs/platform-asks.md`).

## The idea, in one line

Stop *reproducing* Convex semantics at runtime (the `ctx.db` wrapper, the
zod parse on every read/write, the schema-walking dispatch). Instead,
**compile** zodvex source — including codecs — into idiomatic Convex:
`v.*` validators + a small pure-JS **codec class** that wraps the Convex
functions. zod becomes an authoring-time skin the compiler erases; **zero
zod at runtime**.

## Why this shape, not "strip zod off the codec"

A codec's `encode`/`decode` never needed zod to run — zod only ever
*discovered* codec fields (schema walk) and *validated* shapes. So the
runtime form of a codec is naturally pure JS. The design choice (Jake,
2026-06-15) is to **recreate the codec contract as a purpose-built pure-JS
class** that lands directly in the emitted Convex code, rather than import a
zod-codec object minus its schema (a half-thing that still carries zod
lineage). The class is zodvex's own runtime ABI — owned, versioned
independently of zod's churn, guaranteed zod-free.

Conceptually the contract is just:

```
interface CompiledCodec<Wire, Runtime> {
  validator: ConvexValidator       // lowered from the wire zod schema
  encode(runtime: Runtime): Wire   // verbatim user JS
  decode(wire: Wire): Runtime      // verbatim user JS
}
```

The compiled output composes these at the function boundary (args decode in,
returns encode out) and at the db boundary (reads decode, writes encode) —
"wrapping the convex functions," emitted as concrete JS, replacing the
generic runtime `ZodvexDatabaseReader/Writer`.

## THE design problem: single-definition lowering

A custom codec (e.g. `SensitiveField`) must be authored **once** such that it
yields BOTH:
- (a) full zod type inference + dev ergonomics at author time, and
- (b) a lossless emission to the pure-JS `CompiledCodec` class.

`encode`/`decode` drop straight through (already JS). The wire schema lowers
to a `v.*` validator (we already do this via `zodToConvex`). The open work is
the **authoring form** that lets the compiler keep the transforms verbatim
while erasing everything zod. A factory returning
`{ wireZodSchema, runtimeType, encode, decode }` is most of the way there —
the class is the runtime envelope around `encode`/`decode` + the lowered
validator; the zod parts are authoring-only and the compiler discards them.

## Constraints to hold while designing

1. **Transform impl must be zod-free-importable.** The compiler references
   the user's `encode`/`decode` in the emitted bundle, so their runtime logic
   can't live behind zod-only constructs. `SensitiveField` (a crypto wrapper)
   qualifies; the rule is just "transforms are plain JS."
2. **Runtime-side validation is dropped unless the class carries it.** Today
   `decode` runs a zod parse, which also *validates* (refinements,
   `.email()`, …). The pure-JS class only transforms. Pure codecs (date,
   encryption) lose nothing; a codec/field with refinements silently loses
   that check unless we re-emit it as a JS guard. Decide explicitly:
   re-emit guards, or document runtime validation as authoring-time-only.
   (Same edge as codec-paths' decode-by-path, more of it. PR #63 hit this as
   "refines silently lost.")
3. **The db path still needs a `table → codec` map.** Boundary wrapping
   handles args/returns; `db.get`/`query` reads need to know which table's
   codec class to apply, and the relational `db.get(id)` case needs the table
   name at the call site (the `db.get(table, id)` migration dependency —
   news.convex.dev/db-table-name). Emit a pure-JS table→codec-class map + a
   thin wrapped `ctx.db`. **That map is the codec-paths descriptor index,
   re-expressed as classes instead of loose-zod schemas.**

## What it dissolves (vs codec-paths)

- codec-paths makes the runtime zod layer *light*; compile-away *removes* it.
- No zod in any isolate ever (memory cliff gone permanently, not lightened).
- No double validation — Convex validates the emitted `v.*`, the class
  transforms, nothing re-runs a zod parse. CPU win codec-paths doesn't get.
- `ZodvexDatabaseReader/Writer`, descriptors, registry split, tableMap
  machinery → all become build-time artifacts.

## Reuse — nothing from codec-paths is wasted

`walkModelCodecPaths` (codec discovery: which fields on which table are
codecs, with paths) and the `table → codec` mapping are the **front half** of
this. Compile-away emits that same information as pure-JS codec classes
instead of feeding it to a runtime wrapper. codec-paths is the runtime-layer
version; compile-away is the build-time version of the identical mapping.

## Hard dependencies / why it's not scheduled

- **Needs the Convex build-time hook** (platform ask #2) for the clean,
  no-hijack version. Without it you're back to PR #63's shadow tree, which
  Jake rejected. Not shippable library-side.
- **deployed ≠ authored** divergence is intrinsic to any compile-away (stack
  traces, dashboard) — source maps mitigate, don't erase. Convex weighs this
  too.
- **db decode path leans on `db.get(table, id)` adoption** in consumer code.

## Relationship to the other docs

- Supersedes the *mechanism* of PR #63 (shadow-tree `zodvex compile`) with the
  in-bundle-transform framing; keeps #63's transform learnings.
- Ships AFTER codec-paths regardless — codec-paths is the no-platform-help
  answer that's already at parity; this is the "if Convex builds the hook"
  step-change. Pitch to Ian as the vision (zodvex as a build-time *producer*
  of idiomatic Convex), a follow-up to the harness/memory conversation.
