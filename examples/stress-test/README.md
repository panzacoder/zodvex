# Zod v4 OOM Stress Test

Reproduces and measures the Zod v4 out-of-memory crash in Convex's 64 MB V8 isolate. Built to characterize the problem quantitatively before evaluating mitigations.

Upstream issues: [panzacoder/zodvex#49](https://github.com/panzacoder/zodvex/issues/49), [get-convex/convex-backend#414](https://github.com/get-convex/convex-backend/issues/414)

---

## Quick Start: Reproduce the OOM in Under a Minute

```bash
cd examples/stress-test
bun install

# Generate 135 endpoints (baseline, both mode — confirmed OOM threshold)
bun run generate.ts --count=135 --mode=both

# Push to your Convex deployment — this will OOM
npx convex dev
# Expected: "JavaScript execution ran out of memory (maximum memory usage: 64 MB)"

# Confirm 130 endpoints still pass
bun run generate.ts --count=130 --mode=both
npx convex dev
# Expected: succeeds
```

You need a Convex project configured (`convex/` directory with `CONVEX_DEPLOYMENT` set) for the `npx convex dev` step. For standalone V8 measurements without Convex, see the Measurement section below.

---

## How the Generator Works

`generate.ts` produces synthetic Convex modules that use zodvex — the same pattern real applications follow.

### Flags

| Flag | Values | Default | Description |
|------|--------|---------|-------------|
| `--count=N` | integer | 50 | Number of schema/endpoint modules to generate |
| `--mode=` | `both`, `tables-only`, `functions-only` | `both` | Which allocation paths to include |
| `--variant=` | `baseline`, `zod-mini` | `baseline` | Zod import to use |
| `--convex` | flag | off | Generate Convex-compatible bootstrap (vs standalone stub) |
| `--output=path` | path | `convex/generated` | Output directory |

### Modes

- **both** — generates table definitions (`defineZodModel` + `defineZodSchema`) AND query/mutation wrappers (`zq`/`zm`). Represents a real application. This is the mode that OOMs.
- **tables-only** — only the table path. Isolates schema registration cost.
- **functions-only** — only the function path (lightweight model stub, no `defineZodSchema` call). Isolates query/mutation argument schema cost.

### Complexity Tiers

Endpoints are distributed across three tiers to match real-world schema weight:

| Tier | Proportion | Fields | Notable |
|------|-----------|--------|---------|
| small | 50% | 4 fields | strings, boolean, float, timestamp |
| medium | 35% | 11 fields | optional, enum, id ref, array, nested object, nullable |
| large | 15% | 18 fields | discriminated union (contact: email/phone/address), nested arrays, full codec |

---

## Running Measurements

### Standalone V8 (no Convex required)

Run the full report across all scale points and variants:

```bash
bun run report
```

This runs each measurement in an isolated process (to avoid module cache contamination between zod and zod-mini), generates JSON result files per combination, and writes `results/report.md`.

To measure a single combination manually:

```bash
# Generate first
bun run generate.ts --count=100 --mode=both --variant=baseline

# Then measure (--expose-gc required for accurate heap deltas)
bun --expose-gc run measure.ts --count=100 --mode=both --variant=baseline
```

`measure.ts` reports:
- Heap delta from after-import baseline to after-schema-creation (GC'd twice at each point)
- Convex-validator-only baseline at the same scale (no Zod — pure `v.*` validators)
- Per-schema property counts for zod vs zod/mini

### Via Convex

For the binary OOM/pass result against the real isolate:

```bash
# Generate the desired scale
bun run generate.ts --count=130 --mode=both --convex

# Deploy (will either succeed or print the OOM message)
npx convex dev
```

The `--convex` flag switches the `functions.ts` bootstrap from a standalone stub to a real Convex-compatible one that registers functions in the Convex runtime.

---

## Findings

### The OOM threshold is ~132 endpoints in "both" mode

| Endpoints | `npx convex dev` result |
|-----------|------------------------|
| 130 | pass |
| 135 | **OOM** — `JavaScript execution ran out of memory (maximum memory usage: 64 MB)` |

This is lower than the standalone V8 estimate (~170 endpoints) because the Convex isolate carries additional overhead beyond schema loading. Our schemas are also heavier than average — they include codecs, discriminated unions, and nested objects.

### Memory scaling is linear at ~0.37 MB per endpoint (both mode)

| Endpoints | Heap delta (MB) |
|-----------|----------------|
| 50 | 19.03 |
| 100 | 37.32 |
| 150 | 55.20 |
| 200 | 73.33 |
| 250 | 91.19 |

The linearity confirms this is per-schema allocation, not initialization overhead.

### All memory cost is Zod — Convex validators are negligible

Convex-only baseline (pure `v.*` validators, no Zod) at 250 endpoints: **0.57 MB** — less than 1% of the total. The zodvex mapping layer itself is cheap. The problem is Zod v4's per-schema object allocation.

### Both allocation paths contribute

At 200 endpoints:
- Tables-only: 53.82 MB (73% of combined)
- Functions-only: 46.86 MB (64% of combined)

Neither path alone stays under 64 MB at 200 endpoints. Mitigation needs to address both.

### Per-schema property count: zod/mini is 4x smaller

| Schema | Own properties |
|--------|---------------|
| `z.object()` | 61 |
| `zm.object()` (zod/mini) | 15 |

If the property count maps to proportional memory, zod/mini could reduce 73 MB (200 endpoints) to ~18 MB. However, zod/mini has API incompatibilities that prevent direct drop-in use — the full API (`.optional()` as a method, `.discriminatedUnion()`, etc.) is not available in `zod/mini`.

### Lazy loading upper bound

If Zod schema creation could be deferred until first call (rather than at module load time):

| Endpoints | Baseline (MB) | Convex-only (MB) | Max savings (MB) |
|-----------|--------------|-----------------|-----------------|
| 200 | 73.33 | 0.49 | 72.84 |
| 250 | 91.19 | 0.57 | 90.62 |

Peak would drop to ~3 MB — well within the limit. This is the upper bound assuming all Zod allocation can be deferred.

---

## Mitigation Tracks

**Track A — Lazy loading:** Defer Zod schema creation to first invocation. No consumer API changes required. The upper bound shows 99%+ savings are theoretically available. Primary risk: `defineZodSchema` may need to eagerly produce Convex validators for Convex's schema registration.

**Track B — zod/mini:** Replace `zod` with `zod/mini` throughout zodvex. 4x property count reduction. Requires API adapter work, ~100 `instanceof` migrations, and mirrored export subpaths.

**Recommended order:** Track A first (internal change, massive upper bound), Track B if gaps remain.

---

## Full Analysis

See [`results/report.md`](results/report.md) for the complete measurement table, allocation attribution breakdown, and phase decision rationale.
