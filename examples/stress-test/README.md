# Stress Test Harness (real-deploy edition)

Pushes increasingly large composed Convex projects to a real Convex dev deployment and bisects on push success/failure to find each variant's actual OOM ceiling. The push goes through Convex's bundler and into the real 64 MB push-time isolate — same path real users hit.

Previous heap-delta-in-Node-subprocess proxy has been removed: it was misleading (didn't go through Convex's bundler, didn't load `functions.ts`, didn't account for runtime overhead) and gave a false sense of where the OOM cliff lives.

## Setup (once)

```bash
cd examples/stress-test
npx convex dev --configure   # creates .env.local with CONVEX_DEPLOYMENT
```

Pick or create a fresh dev deployment. Each ceiling-search run wipes the deployment's schema and re-pushes thousands of tables, so don't point this at anything you care about.

## Variants

| Flavor | What it tests |
|--------|---------------|
| **`convex`** | Pure `defineTable` + `v.*` + plain `query`/`mutation`. Ideal baseline. |
| **`convex-helpers/zod3`** | `convex-helpers/server/zod3` (`zCustomQuery` etc.). |
| **`convex-helpers/zod4`** | `convex-helpers/server/zod4`. |
| **`zod`** | Default zodvex. |
| **`zod + slim`** | zodvex with `{ schemaHelpers: false }` per model. |
| **`zod + codegen`** | zodvex + `zodvex generate` (codegen-using app pattern). |
| **`zod + compile`** | zodvex + `zodvex compile` (build-time AOT to vanilla Convex). |
| **`mini`** | zodvex via `zod/mini`. |
| **`mini + slim`** | zod/mini + slim models. |

## Usage

```bash
# Build zodvex first (the runner invokes the workspace dist directly)
cd ../.. && bun run build && cd examples/stress-test

# Full ceiling search across all variants. Slow — each variant takes ~5–15 min
# of real Convex pushes.
bun run stress-test

# One variant only
bun run stress-test -- --convex
bun run stress-test -- --compile
bun run stress-test -- --mini --slim

# Single push at an exact count (for debugging a specific failure)
bun run stress-test -- --count=500 --compile
```

## How it works

1. **Seeds** (`seeds/<flavor>/`) — 7 hand-written model + endpoint pairs (small/medium/large) per flavor. Every flavor implements the same logical schemas; the library under test is the only variable.
2. **Compose** (`compose.ts`) — scales seeds to N models via file copy + identifier rename, writing **directly into `convex/`** (the Convex project root). Targeted wipe leaves `_generated/`, `convex.config.ts`, `tsconfig.json` intact.
3. **Optional transforms**:
   - `--mini`: `zod-to-mini` codemod over the composed source.
   - `--compile`: `zodvex compile` rewrites endpoints/models/schema to vanilla Convex.
   - `--codegen`: `zodvex generate` emits `_zodvex/`.
4. **Push** — `npx convex dev --once --typecheck=disable --codegen=disable`. Exit code + stderr classifies the result as `pushed` / `oom` / `bundle-size` / `timeout` / `other`.
5. **Bisect** — doubling coarse pass until first failure, then binary search down to ±25 endpoints. Records every probe in `results/report.{md,json}`.

## Flags

| Flag | Description |
|------|-------------|
| `--count=N` | Single push at N endpoints (skips ceiling search) |
| `--convex` | Pure Convex baseline |
| `--convex-helpers` | `convex-helpers/server/zod4` |
| `--convex-helpers-zod3` | `convex-helpers/server/zod3` |
| `--slim` | zodvex with `{ schemaHelpers: false }` |
| `--mini` | zodvex via zod/mini |
| `--codegen` | zodvex + codegen |
| `--compile` | zodvex + `zodvex compile` |
