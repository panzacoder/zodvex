# Slim Model Memory Comparison

**Date:** 2026-04-14
**Mode:** both (tables + functions)
**Variant:** baseline (full zod)
**Template:** shared (shared field references)

## Results

| Scale | Full (MB) | Slim (MB) | Savings (MB) | Savings (%) | Per-model (KB) |
|-------|-----------|-----------|-------------|-------------|----------------|
| 50 | 27.25 | 24.26 | 2.99 | 11.0% | ~60 |
| 100 | 53.99 | 47.83 | 6.16 | 11.4% | ~62 |
| 150 | 80.27 | 71.14 | 9.13 | 11.4% | ~61 |
| 200 | 106.93 | 94.60 | 12.33 | 11.5% | ~62 |

## Analysis

- **~61 KB per model saved** — linear scaling confirmed
- The spec estimated ~77 KB savings. The measured ~61 KB (~80% of estimate) reflects:
  - Slim models still construct `doc` eagerly (1 Zod object for system fields)
  - `defineZodSchema` derives all 6 schemas via `zx.*` helpers at registration time
  - The savings come from not storing 4 derived schemas on the model object itself
- At **150 models**, slim saves ~9.1 MB — ~14% of Convex's 64 MB budget
- At **200 models**, slim saves ~12.3 MB — could push the OOM wall back ~20+ models

## Practical Impact

For a typical Convex app at 100-150 models (the OOM danger zone for full zod):
- Full: 54-80 MB → likely OOM on Convex's 64 MB isolate
- Slim: 48-71 MB → still tight, but buys meaningful headroom
- Combined with zod/mini migration: would reduce to ~25-35 MB (comfortable)
