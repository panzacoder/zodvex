# The actual fix: multi-dot filenames dodge Convex's entrypoint discovery

Root cause of the persistent "Loading the pushed modules" OOM has been
isolated. The schema-only-thin change was correct in spirit but didn't
move the deploy ceiling because of a separate, mechanical issue with
how Convex discovers function modules.

## Convex's entryPoints() — what gets analyzed

In `node_modules/convex/.../bundler/index.js:276 entryPoints()`, the CLI
walks `convex/` and treats every file as an entrypoint UNLESS:

- it's in `_generated/` or `_deps/`
- it starts with `.` (dotfiles)
- it starts with `#` (emacs tempfiles)
- its basename is `schema.ts` or `schema.js`
- **its basename contains multiple dots** (`*.foo.{ts,js}`)
- its path contains a space

Each entrypoint is bundled + loaded into its own 64 MB isolate for
analysis. **`_zodvex/api.js` (one dot) qualifies as an entrypoint.**
At N=200 it's a ~158 KB file containing ~600 inline zod schemas. Loading
it alone exceeds 64 MB.

Our `_zodvex/api.lazy.js` (two dots) is correctly skipped, but it
doesn't help because nothing prevents Convex from loading `api.js`
directly as its own entrypoint.

## Empirical confirmation

Composed `zodvex --lazy-tables N=200` (just-shipped schema-only-thin):

| Variant | Real-deploy outcome |
|---|---|
| As-is | **OOM** at module load |
| `_zodvex/api.js` stubbed to empty | **ok** |
| `api.js` → `api.data.js` + `client.js` → `client.codec.js` rename | **ok** |

The third variant is the production-shape fix. Both heavy files get
multi-dot names; Convex skips them as entrypoints; they're reachable
only via dynamic-import (api.lazy.js) or named import (client.codec.js).

## New ceilings with the rename

| N | Result | Deploy time |
|---|---|---:|
| 200 | ok | 10 s |
| 500 | ok | 23 s |
| 1000 | ok | 39 s |
| 1500 | ok | 48 s |
| 2000 | ok | 56 s |

Matches the pure-convex baseline ceiling (~2000 endpoints before
hitting non-memory limits like TooManyReads). Compared to the
shipped-but-unhelpful baseline (~150 endpoints), that's a **13×
improvement** — and unlike slim models or zod-mini, this needs no
schema simplification or library migration.

## What this means for the per-entrypoint analysis story

The "per-entrypoint analysis" Convex introduced is real, but its
practical effect for zodvex consumers was masked by:

1. Every file under `_zodvex/` (single-dot names) being itself an
   entrypoint.
2. The codegen's `api.js` being a fat single file that exceeded the
   per-entrypoint 64 MB cap on its own.

So consumers saw: "I made my schema thin via lazy patterns, why does
my deploy still OOM?" Because the codegen output was itself an
entrypoint and was the limit.

The fix is structural to the codegen, not the consumer's app:
- Files that are LAZY-LOAD TARGETS (heavy on purpose) should have
  multi-dot names so Convex skips them as entrypoints.
- Files that are CLIENT-CONSUMED (statically import heavy targets)
  should also have multi-dot names — otherwise Convex still walks
  them as entrypoints and pulls the heavy content in transitively.

## Implications for the next codegen change

We need to rename:
- `_zodvex/api.js` → `_zodvex/api.data.js` (the heavy registry)
- `_zodvex/client.js` → `_zodvex/client.codec.js` (statically imports api.data)
- Possibly `_zodvex/tableMap.lazy.js` already OK (multi-dot)

Userland imports change one-for-one. Migrate transform can handle it.

## Response to Ian

Two-paragraph form:

> We did the per-entrypoint analysis work and it's correct: schema.ts
> stays tiny, individual endpoint bundles stay tiny. What we hit instead
> is that Convex's entryPoints walker picks up every `*.{ts,js}` in
> `convex/` (except the documented exceptions) as a separate
> entrypoint, each analyzed in its own 64 MB isolate. zodvex's codegen
> emits a few files under `convex/_zodvex/` that the walker also
> ingests — chief among them `api.js` which holds the registry of
> inline `z.object({...})` schemas per function and scales linearly
> with endpoint count.
>
> Renaming those files to multi-dot names (e.g. `api.data.js`) makes
> the walker skip them; they're still imported by other files
> dynamically or by name, but they no longer get their own 64 MB
> analysis isolate. With that change applied, deploys pass through
> N=2000 endpoints (matching pure-convex baselines) instead of failing
> at N=155.

Then ask:
1. Is the multi-dot skip rule intentional and stable, or is it a
   side-effect of generic-glob matching we shouldn't rely on?
2. Are there other "skip me as entrypoint" conventions for codegen
   output directories beyond `_generated/` and the multi-dot pattern?
3. Would convex consider documenting an `_zodvex/`-style convention
   for tooling that emits non-entrypoint modules into `convex/`?

## Files

- `examples/stress-test/results/multi-dot-rename-2026-05-13.md` (this file)
