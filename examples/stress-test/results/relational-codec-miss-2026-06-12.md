# Empirical: what the failure mode actually looks like (NAIVE per-endpoint, old calling convention)

Date: 2026-06-12. One probe function, real deploys, two topologies. The
probe (`endpoints/healthcheck_rel.ts` in the composed trees) imports ONLY
its own model (`HealthcheckRefModel`) and follows a foreign key into the
codec table `healthchecks` (`at: zx.date()`) — the everyday
relation-follow pattern, written with the OLD `db.get(id)` convention.

> **CORRECTION (2026-06-15).** The original framing below called this a
> "silent-data-corruption class" of per-endpoint topology *in general*.
> That overstates it. The silent miss is a property of the **naive**
> design we tested: the old `db.get(id)` convention (no table name at the
> call site) + no manifest. Two things change it:
>   - Convex's `db.get(table, id)` migration (news.convex.dev/db-table-name)
>     puts a table-name literal at every call site, FK lookups included.
>     The wrapper then KNOWS the call targets `users` even without `users`'
>     model in the isolate.
>   - A tiny zero-zod `tableName → hasCodecs` manifest (the
>     `per-endpoint-model-registration.md` plan already specified one) lets
>     the wrapper THROW on a miss against a codec table instead of passing
>     wire data through.
>
> Together those convert the **silent** miss into a **loud** one. So the
> table name still doesn't enable *decoding* without the model present (the
> schema isn't in the isolate — only detection is possible at runtime), but
> "silent corruption" is not the disqualifier for a properly-guarded
> registration design. **The actual decider for codec-paths over any
> registration/per-endpoint-graph variant is ceiling-saturation, not
> safety:** codec-paths already hits Convex's own TooManyReads wall at
> N=800 (the same non-memory wall raw `defineTable` hits), so a
> per-endpoint design — which can't push past that deploy-transaction wall
> either — would add import-discipline / build-analysis machinery + a
> dependency on consumers having adopted `db.get(table, id)`, to reach the
> exact same ceiling. The measurement below is still a valid cautionary
> data point about the *naive* shape; read it as that, not as proof
> against all per-endpoint designs.

## The A/B

| | centralized tableMap (today's shapes) | per-endpoint graph (model not in isolate) |
|---|---|---|
| read `child.at` | `Date` (decoded) | **`number` — silent, no error, no warning** |
| write `{ at: new Date() }` | encoded to wire ✓ | **throws** `Date ... is not a supported Convex type` |
| write `{ at: 1700000000000 }` (wire) | throws (encode expects runtime value) | accepted silently |

## What a user actually experiences

- **Reads are silently wrong.** No exception, no log line — the doc simply
  carries wire values. For `zx.date()` that's a number where code expects
  a Date (`.getTime()` → runtime TypeError somewhere downstream, far from
  the cause). For `SensitiveField`-class codecs it's worse: the ENCODED
  wire shape flows into application code as if decoded — wrong data, not
  a crash.
- **Writes split by codec type.** Runtime values that aren't Convex types
  (Date, Symbol, class instances) fail loudly at the serializer — but
  with a confusing message pointing at Convex types, not at the missing
  model. Number/string-backed codecs (SensitiveField again) write
  UNENCODED data silently.
- The type system says everything is fine in all of these cases — types
  come from `DecodedDocs`, which is global and doesn't know what the
  isolate loaded.

So: **the NAIVE per-endpoint shape (old `db.get(id)` convention, no
manifest) converts a memory cliff into a silent-data-corruption class.**
Confirmed, not hypothetical — but see the 2026-06-15 correction at the
top: enforced table-name args + a manifest make this miss *loud*, not
silent. The reason codec-paths still wins is ceiling-saturation, not this.

## The underlying constraint (succinct, for the Convex conversation)

A codec library needs per-TABLE schema information available wherever
`ctx.db` is used. Convex evaluates each entrypoint's module graph
independently (the #414 fix) in a 64 MB isolate, and the Q/M runtime
forbids dynamic `import()` — so the ONLY way to make all tables' schemas
reachable is a static all-models import from a central module, which
costs ~0.2–0.3 MB per model (zod v4 eval) **per isolate** and caps
codec-on apps at ~100–150 models. Removing the central graph restores
≥800-model deploys (measured: `per-endpoint-spike-2026-06-12.md`) but
creates the silent-miss class above *in its naive form* (loud with
enforced table names + a manifest), because "which models are loaded"
becomes per-isolate while the decode contract is global. Note the deploy
ceiling is the same either way — Convex's TooManyReads wall at N≈800 —
so removing the central graph buys no headroom over a *minimal* central
graph (codec-paths), which is the reason codec-paths is preferred.

Platform-level options worth raising with Convex:

1. **Dynamic `import()` in Q/M isolates** (even resolve-once-then-sync) —
   a codec layer could lazy-load the table's schema on first touch. The
   clean fix.
2. **Shared evaluation of `_deps` chunks across entrypoint isolates** —
   the model graph is identical in every endpoint; evaluating it once per
   deployment instead of once per entrypoint removes the multiplier.
3. A declared "shared/data module" tier with its own budget.

Library-level options without platform help:

4. **Per-endpoint registration + import discipline** (the spike): works,
   proven to N≥800. The naive form ships the silent-miss class; enforced
   `db.get(table, id)` + a manifest make misses LOUD (throw) instead. Set
   aside not for safety but because it reaches the same N≈800 ceiling as
   codec-paths while costing import discipline (or a build step) + a
   dependency on consumers having migrated their db calls.
5. **Codec-paths manifest instead of model schemas — the most promising
   non-breaking direction.** Decode doesn't need a model's full zod doc
   schema; it only needs *which paths hold which codecs*. Codegen
   already discovers exactly that (the model-codec walk with access
   paths). Emit a static, zod-free per-table descriptor map
   (`tableName → [{ path, codecRef }]`) where codecRefs import only the
   handful of shared codec MODULES (zx.date, the SensitiveField
   factory, …) — O(bytes) per table instead of O(model). The central map
   stays central (no import discipline, no per-isolate ambiguity,
   relational lookups keep decoding), but it weighs ~nothing per
   endpoint. Trade-off: decode-by-path transforms codec fields without
   full-doc zod validation on read (validation already ran at write).
   Needs its own spike: per-endpoint cost target ≈ floor, plus the
   relational probe returning `decoded: true`.
6. Static analysis to compute each endpoint's minimal model graph and
   inject imports at build time — over-approximation is safe (extra
   imports = just memory), but it edits user files or re-bundles
   (#63 territory).
