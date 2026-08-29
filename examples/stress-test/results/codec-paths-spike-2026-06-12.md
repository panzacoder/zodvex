# SPIKE RESULT: codec-paths descriptors ("option 3") — PROVEN, full parity

> **PRODUCTIONIZED 2026-06-13** — real `zodvex generate` output meets this
> bar cell-for-cell: see `sweep-codec-paths-production-2026-06-13.json` +
> `sweep-codec-paths-final-2026-06-13.json` (full zod clean ≤750,
> TooManyReads at 800; mini identical). Required beyond the spike: union
> descriptor support w/ inferred discriminators, minimal args-registry
> entries, and a type-only schema import in server.ts.

Date: 2026-06-12. Shape `--shape=codec-paths`, zero library changes. Codegen
(spike-grade, in compose) emits `_zodvex/models/<table>.ts` — a MINIMAL
loose zod schema per codec-bearing table (codec fields only; unknown keys
pass through) — plus a statically-imported index used as the central
tableMap. Consumer API completely unchanged: `db.get(id)`, relational
lookups, wrapDb semantics identical to today.

## The ladder (full zod, codecs ON, real deploys, reset per cell)

| | N=200 | 400 | 600 | 750 | 800 |
|---|---|---|---|---|---|
| codec-paths (API unchanged) | ✓ | ✓ | ✓ | ✓ | **too-many-reads** |
| pure convex / floor, same day | ✓ | | ✓ | ✓ | too-many-reads |
| centralized shapes (codecs ON) | **OOM at 150** | | | | |

**Exact parity with pure convex: same wall (TooManyReads, Convex's own
fresh-diff transaction limit), same N.** Memory is no longer the
constraint anywhere on the ladder.

## Correctness — the cell that killed the registration design

`relationalCodecProbe` (follows a foreign key into a codec table whose
model the endpoint never imports):

| | registration spike | codec-paths spike |
|---|---|---|
| relational lookup | `{ decoded: false, runtimeType: 'number' }` — silent miss | **`{ decoded: true, runtimeType: 'Date' }`** |
| write path | raw passthrough | encoded |

Healthcheck (decode round-trip + scheduler codec-arg encoding) passed at
every passing cell.

## Cost profile

Per-endpoint heap at N=200: **10.4 MB** (floor 2.4, centralized 84.4).
Descriptor cost ≈ 0.04 MB/table with the loose-zod spike implementation —
6× cheaper than model schemas; linear fit puts the loose-zod cliff around
N≈1,400 (beyond Convex's own N≈800 wall, so irrelevant in practice). A
production implementation can drop loose-zod for a pure path-walker
(descriptors as data + shared codec instances) to approach the floor, but
the spike shows it isn't required to reach platform parity.

## Spike → production deltas

1. Real discovery: replace compose's regex with codegen's existing
   modelCodecs walk (full access paths, any codec, arrays/optionals;
   unions need path mapping — the one fiddly part).
2. Custom codecs must be importable without their model (standalone
   export / branded factory — already the api.js rule). Fallback:
   a table whose codec is inline imports its model — per-table cost,
   not a cliff.
3. Emit from `zodvex generate` into `_zodvex/models/`; `server.ts`
   passes the index as the default tableMap (replacing the all-models
   static map). The explicit/legacy `defineZodSchema` path keeps working
   unchanged.
4. Optional later: accept `Model` as the table specifier in db ops
   (`db.get(UserModel, id)`) for precise types + BYO-ID readiness,
   aligned with Convex's `db.get(table, id)` migration (news.convex.dev
   /db-table-name). Codec-paths makes this an ergonomics upgrade, not a
   correctness requirement.

## Verdict

Option 3 delivers everything: codecs at pure-convex parity, zero API
change, no import discipline, no per-isolate ambiguity at all, relational
lookups intact. It supersedes the per-endpoint registration design (kept
in results/per-endpoint-spike-2026-06-12.md as the experiment that proved
the topology hypothesis).

> Note (2026-06-15): the registration A/B above shows a *silent* miss
> because the spike used the old `db.get(id)` convention with no manifest.
> Enforced `db.get(table, id)` + a manifest would make that miss loud, not
> silent — so the real reason codec-paths wins isn't safety, it's that
> both designs hit Convex's SAME N≈800 TooManyReads wall, and codec-paths
> reaches it with no import discipline and no consumer-migration
> dependency. See the correction in `relational-codec-miss-2026-06-12.md`.
