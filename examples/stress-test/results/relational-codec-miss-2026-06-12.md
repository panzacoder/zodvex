# Empirical: what the failure mode actually looks like (no API changes)

Date: 2026-06-12. One probe function, real deploys, two topologies. The
probe (`endpoints/healthcheck_rel.ts` in the composed trees) imports ONLY
its own model (`HealthcheckRefModel`) and follows a foreign key into the
codec table `healthchecks` (`at: zx.date()`) — the everyday
relation-follow pattern.

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

So: **without API changes, per-endpoint topology converts a memory cliff
into a silent-data-corruption class.** Confirmed, not hypothetical.

## The underlying constraint (succinct, for the Convex conversation)

A codec library needs per-TABLE schema information available wherever
`ctx.db` is used. Convex evaluates each entrypoint's module graph
independently (the #414 fix) in a 64 MB isolate, and the Q/M runtime
forbids dynamic `import()` — so the ONLY way to make all tables' schemas
reachable is a static all-models import from a central module, which
costs ~0.2–0.3 MB per model (zod v4 eval) **per isolate** and caps
codec-on apps at ~100–150 models. Removing the central graph restores
≥800-model deploys (measured: `per-endpoint-spike-2026-06-12.md`) but
creates the silent-miss class above, because "which models are loaded"
becomes per-isolate while the decode contract is global.

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
   proven to N≥800, but ships the silent-miss class unless paired with
   manifest + throw semantics (the ergonomics concern).
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
