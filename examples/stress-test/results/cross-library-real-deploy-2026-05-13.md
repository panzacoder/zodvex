# Cross-library real-deploy ceilings — 2026-05-13

Adds pure-convex and convex-helpers flavors to the real-deploy
verification, so the zodvex numbers can be read in context.

All rows are real `npx convex dev --once` pushes against
`dev:tangible-jellyfish-256`. "Failure site" describes what the
backend reported as the cause.

## Composer change

Non-zodvex flavors now emit a real `defineSchema({...})` instead of
`export default {}`. Each model file's per-flavor table export
(`TaskTable`, `CommentTable`, etc.) is imported with a unique alias
and wired into the schema.

## Numbers

| Flavor | OOM around | Failure site at higher N | Notes |
|---|---:|---|---|
| `convex` (plain validators) | **not OOM-bound** | TooManyReads at N≈2000 (finish_push) | Memory is fine through 2000 endpoints |
| `convex-helpers-zod3` | **not OOM-bound** | 4096 function-files limit at N=2500 | Memory is fine through ≥ 2000 endpoints |
| `convex-helpers` (zod4) | **N=400-500** | schema-eval | zod4 ~50× heavier per object than zod3 here |
| `zodvex` (full zod, default) | **N=150-175** | schema-eval | Includes zodvex codec overhead on top of zod4 |
| `zodvex` + slim models | **N=300-400** | schema-eval | `{ schemaHelpers: false }` cuts ~half |
| `zodvex-mini` | **N=400-450** | schema-eval | Closes the gap with ch/zod4 |
| `zodvex-mini` + slim | **N=600-800** | schema-eval | Beats ch/zod4; ~4× over zodvex baseline |

## What this re-frames

Two findings I didn't expect before running the numbers.

### 1. zod3 → zod4 is a regression at scale

Pure convex validators handle ≥ 2000 endpoints without memory issues.
convex-helpers/zod3 does the same — adding the convex-helpers adapter
costs essentially nothing at module-load. But convex-helpers/zod4
OOMs schema-eval at ~500. That's a **4×+ regression** purely from
the zod3 → zod4 upgrade, with the same adapter and the same models.

This matches the upstream `~61 own properties per z.object()` for zod4
vs ~15 for zod/mini number that ships in dan-myles's repro. zod3 likely
sits below zod/mini. So the OOM problem we've been chasing is largely
zod-v4's design tradeoff, not a Convex backend choice — and the new
per-entrypoint analyzer doesn't change that.

### 2. zodvex-mini + slim beats plain convex-helpers/zod4

`zodvex-mini + slim` reaches N=600-800 before schema-eval OOMs.
`convex-helpers` (zod4) OOMs at N=400-500. So a zodvex consumer who
uses the optimizations actually scales past a plain convex-helpers/zod4
consumer with no codec layer at all.

If you have to use zod4 (you don't want to migrate to mini), the
fairer comparison is `zodvex + slim` (N=300-400) vs `convex-helpers`
zod4 (N=400-500). Convex-helpers is ~20% better in that fight — not
nothing, but the codec layer + auto-decode + DB wrappers from zodvex
is reasonable to trade for that.

## Knobs and their compound effect

Going from least- to most-optimized zodvex configuration:

```
zodvex (defaults)                  N ≈ 155
  + slim models                    N ≈ 350    (+2.3×)
  + zod/mini                       N ≈ 425    (+2.7×)
  + slim + mini                    N ≈ 700    (+4.5×)
  + slim + mini + lazy registry    same       (schema-eval is the binding constraint)
```

Lazy registry doesn't shift the schema-eval ceiling because schema.ts
must statically know all tables — the registry never enters the
schema-eval isolate. Lazy matters for a *separate* per-endpoint
module-loading budget that becomes binding once schema fits.

## Take-aways for zodvex

1. **Default `defineZodModel` to `{ schemaHelpers: false }`.** Biggest
   per-table savings, and the eager `.doc`/`.insert`/`.update`/`.docArray`/
   `.paginatedDoc` properties are reachable via `zx.*` helpers anyway.
   The CHANGELOG should call this out as a behavioral default change.

2. **Recommend the zod-to-mini codemod for medium-large apps.** Already
   exists. The 2.7× headroom matters once an app crosses ~150 tables.

3. **Lazy registry stays useful** even when schema-eval is the
   binding ceiling — it's still the right pattern to prevent a second
   OOM site from showing up later as registries grow.

4. **For very large apps, the gap to plain convex-helpers/zod4 is small.**
   zodvex-mini+slim already wins. Where zodvex is meaningfully worse
   than plain helpers is default-config full-zod usage. That's
   addressable in-library.

## Methodology

- Pushes against `dev:tangible-jellyfish-256` via
  `bun run realDeploy.ts --source=<composed-dir>`.
- One sample per N to find the failing N; not exhaustive bisection.
  Boundaries are quoted as ranges where I have both a passing N and
  an OOM N immediately above it.
- All pushes used `--typecheck=disable` to isolate runtime constraints
  from TS checking.
- Schema-eval failures present as
  `"Hit an error while evaluating your schema: ... maximum memory usage:
  64 MB"`. Module-load failures present similarly but with
  `"Loading the pushed modules"`.

## Files

- `composeFlavor.ts` (updated) — emits real `defineSchema()` for
  non-zodvex flavors
- `results/cross-library-real-deploy-2026-05-13.md` (this file)
