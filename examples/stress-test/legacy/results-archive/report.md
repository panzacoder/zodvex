# Zod v4 OOM Stress Test Results

**Date:** 2026-04-09
**Scale points:** 50, 100, 150, 200, 250
**Variants:** baseline, compiled, zod-mini

## Import Baselines (memory floor before any user schemas)

| Package | Heap Delta (MB) |
|---------|----------------|
| zod | 0.74 |
| zod/mini | 0.70 |

## Results

| Variant | Mode | Count | Heap Delta (MB) | Peak Heap (MB) | Loaded/Failed | Convex-Only Delta (MB) | Convex-Only Peak (MB) |
|---------|------|-------|----------------|---------------|--------------|----------------------|---------------------|
| baseline | tables-only | 50 | 12.12 | 14.86 | 50/0 | 0.21 | 2.28 |
| baseline | functions-only | 50 | 10.86 | 13.60 | 50/0 | 0.21 | 2.28 |
| baseline | both | 50 | 15.95 | 18.69 | 100/0 | 0.21 | 2.28 |
| compiled | tables-only | 50 | 5.65 | 8.39 | 50/0 | 0.21 | 2.28 |
| compiled | functions-only | 50 | 5.47 | 8.21 | 50/0 | 0.20 | 2.27 |
| compiled | both | 50 | 7.87 | 10.61 | 100/0 | 0.20 | 2.27 |
| zod-mini | tables-only | 50 | 5.76 | 8.50 | 50/0 | 0.21 | 2.27 |
| zod-mini | functions-only | 50 | 5.47 | 8.21 | 50/0 | 0.20 | 2.27 |
| zod-mini | both | 50 | 8.05 | 10.80 | 100/0 | 0.21 | 2.28 |
| baseline | tables-only | 100 | 23.89 | 26.65 | 100/0 | 0.31 | 2.39 |
| baseline | functions-only | 100 | 21.36 | 24.12 | 100/0 | 0.31 | 2.38 |
| baseline | both | 100 | 31.47 | 34.24 | 200/0 | 0.31 | 2.38 |
| compiled | tables-only | 100 | 10.83 | 13.59 | 100/0 | 0.32 | 2.39 |
| compiled | functions-only | 100 | 10.45 | 13.22 | 100/0 | 0.32 | 2.38 |
| compiled | both | 100 | 15.09 | 17.85 | 200/0 | 0.31 | 2.39 |
| zod-mini | tables-only | 100 | 10.93 | 13.69 | 100/0 | 0.32 | 2.39 |
| zod-mini | functions-only | 100 | 10.45 | 13.21 | 100/0 | 0.31 | 2.38 |
| zod-mini | both | 100 | 15.32 | 18.08 | 200/0 | 0.31 | 2.38 |
| baseline | tables-only | 150 | 35.33 | 38.10 | 150/0 | 0.40 | 2.47 |
| baseline | functions-only | 150 | 31.41 | 34.18 | 150/0 | 0.40 | 2.47 |
| baseline | both | 150 | 46.65 | 49.41 | 300/0 | 0.40 | 2.47 |
| compiled | tables-only | 150 | 15.86 | 18.62 | 150/0 | 0.40 | 2.47 |
| compiled | functions-only | 150 | 15.18 | 17.96 | 150/0 | 0.40 | 2.47 |
| compiled | both | 150 | 22.16 | 24.93 | 300/0 | 0.40 | 2.46 |
| zod-mini | tables-only | 150 | 15.97 | 18.74 | 150/0 | 0.41 | 2.47 |
| zod-mini | functions-only | 150 | 15.18 | 17.96 | 150/0 | 0.40 | 2.47 |
| zod-mini | both | 150 | 22.41 | 25.18 | 300/0 | 0.40 | 2.46 |
| baseline | tables-only | 200 | 47.01 | 49.79 | 200/0 | 0.49 | 2.56 |
| baseline | functions-only | 200 | 41.77 | 44.54 | 200/0 | 0.49 | 2.55 |
| baseline | both | 200 | 62.06 | 64.84 | 400/0 | 0.49 | 2.56 |
| compiled | tables-only | 200 | 20.98 | 23.76 | 200/0 | 0.49 | 2.56 |
| compiled | functions-only | 200 | 20.04 | 22.82 | 200/0 | 0.49 | 2.56 |
| compiled | both | 200 | 29.30 | 32.08 | 400/0 | 0.49 | 2.55 |
| zod-mini | tables-only | 200 | 21.09 | 23.87 | 200/0 | 0.49 | 2.55 |
| zod-mini | functions-only | 200 | 20.04 | 22.82 | 200/0 | 0.50 | 2.56 |
| zod-mini | both | 200 | 29.51 | 32.29 | 400/0 | 0.49 | 2.56 |
| baseline | tables-only | 250 | 58.36 | 61.14 | 250/0 | 0.58 | 2.65 |
| baseline | functions-only | 250 | 51.84 | 54.61 | 250/0 | 0.57 | 2.64 |
| baseline | both | 250 | 77.21 | 79.98 | 500/0 | 0.58 | 2.64 |
| compiled | tables-only | 250 | 25.95 | 28.74 | 250/0 | 0.57 | 2.64 |
| compiled | functions-only | 250 | 24.76 | 27.54 | 250/0 | 0.58 | 2.65 |
| compiled | both | 250 | 36.35 | 39.13 | 500/0 | 0.58 | 2.64 |
| zod-mini | tables-only | 250 | 26.06 | 28.84 | 250/0 | 0.57 | 2.65 |
| zod-mini | functions-only | 250 | 24.76 | 27.54 | 250/0 | 0.57 | 2.64 |
| zod-mini | both | 250 | 36.58 | 39.36 | 500/0 | 0.58 | 2.65 |

> FAILED = variant could not load all modules (API compatibility gaps). These rows have no valid
> heap measurement. This is itself a finding: the variant needs dedicated templates or API adaptation.

## Analysis

_Fill in after reviewing results._

## Key Questions Answered

- [ ] Which allocation path dominates: tables or functions?
- [ ] Does zod-mini reduce per-schema memory vs full zod?
- [ ] What is the lazy loading upper bound (baseline - convex_only)?
- [ ] What is the Convex-validator-only cost at scale?
- [ ] At what scale point does baseline hit the ~64MB wall?
- [ ] Does compiled output match zod-mini memory profile (within ±5%)?