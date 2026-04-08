# Zod v4 OOM Stress Test Results

**Date:** 2026-04-08
**Scale points:** 50, 100, 150, 200, 250
**Variants:** baseline, compiled, zod-mini

## Import Baselines (memory floor before any user schemas)

| Package | Heap Delta (MB) |
|---------|----------------|
| zod | 0.72 |
| zod/mini | 0.70 |

## Results

| Variant | Mode | Count | Heap Delta (MB) | Peak Heap (MB) | Loaded/Failed | Convex-Only Delta (MB) | Convex-Only Peak (MB) |
|---------|------|-------|----------------|---------------|--------------|----------------------|---------------------|
| baseline | tables-only | 50 | 12.12 | 14.88 | 50/0 | 0.21 | 2.29 |
| baseline | functions-only | 50 | 10.87 | 13.62 | 50/0 | 0.20 | 2.27 |
| baseline | both | 50 | 15.94 | 18.70 | 100/0 | 0.20 | 2.28 |
| compiled | tables-only | 50 | 5.64 | 8.40 | 50/0 | 0.21 | 2.27 |
| compiled | functions-only | 50 | 5.47 | 8.23 | 50/0 | 0.20 | 2.27 |
| compiled | both | 50 | 7.87 | 10.63 | 100/0 | 0.21 | 2.27 |
| zod-mini | tables-only | 50 | 5.77 | 8.53 | 50/0 | 0.21 | 2.28 |
| zod-mini | functions-only | 50 | 5.47 | 8.22 | 50/0 | 0.20 | 2.27 |
| zod-mini | both | 50 | 8.07 | 10.82 | 100/0 | 0.21 | 2.27 |
| baseline | tables-only | 100 | 23.87 | 26.65 | 100/0 | 0.31 | 2.38 |
| baseline | functions-only | 100 | 21.35 | 24.13 | 100/0 | 0.31 | 2.39 |
| baseline | both | 100 | 31.47 | 34.25 | 200/0 | 0.32 | 2.38 |
| compiled | tables-only | 100 | 10.82 | 13.60 | 100/0 | 0.31 | 2.38 |
| compiled | functions-only | 100 | 10.46 | 13.24 | 100/0 | 0.32 | 2.38 |
| compiled | both | 100 | 15.10 | 17.88 | 200/0 | 0.32 | 2.39 |
| zod-mini | tables-only | 100 | 10.93 | 13.71 | 100/0 | 0.32 | 2.38 |
| zod-mini | functions-only | 100 | 10.46 | 13.24 | 100/0 | 0.31 | 2.38 |
| zod-mini | both | 100 | 15.33 | 18.11 | 200/0 | 0.31 | 2.38 |
| baseline | tables-only | 150 | 35.32 | 38.10 | 150/0 | 0.40 | 2.47 |
| baseline | functions-only | 150 | 31.40 | 34.19 | 150/0 | 0.40 | 2.47 |
| baseline | both | 150 | 46.63 | 49.42 | 300/0 | 0.40 | 2.47 |
| compiled | tables-only | 150 | 15.85 | 18.64 | 150/0 | 0.40 | 2.47 |
| compiled | functions-only | 150 | 15.18 | 17.97 | 150/0 | 0.40 | 2.46 |
| compiled | both | 150 | 22.15 | 24.94 | 300/0 | 0.40 | 2.47 |
| zod-mini | tables-only | 150 | 15.97 | 18.76 | 150/0 | 0.40 | 2.47 |
| zod-mini | functions-only | 150 | 15.19 | 17.97 | 150/0 | 0.40 | 2.47 |
| zod-mini | both | 150 | 22.42 | 25.20 | 300/0 | 0.40 | 2.47 |
| baseline | tables-only | 200 | 47.01 | 49.81 | 200/0 | 0.49 | 2.56 |
| baseline | functions-only | 200 | 41.76 | 44.56 | 200/0 | 0.49 | 2.55 |
| baseline | both | 200 | 62.06 | 64.86 | 400/0 | 0.49 | 2.56 |
| compiled | tables-only | 200 | 20.98 | 23.78 | 200/0 | 0.49 | 2.56 |
| compiled | functions-only | 200 | 20.04 | 22.84 | 200/0 | 0.49 | 2.56 |
| compiled | both | 200 | 29.30 | 32.10 | 400/0 | 0.49 | 2.56 |
| zod-mini | tables-only | 200 | 21.10 | 23.90 | 200/0 | 0.49 | 2.56 |
| zod-mini | functions-only | 200 | 20.04 | 22.83 | 200/0 | 0.49 | 2.56 |
| zod-mini | both | 200 | 29.53 | 32.32 | 400/0 | 0.49 | 2.56 |
| baseline | tables-only | 250 | 58.36 | 61.16 | 250/0 | 0.57 | 2.64 |
| baseline | functions-only | 250 | 51.83 | 54.63 | 250/0 | 0.58 | 2.65 |
| baseline | both | 250 | 77.21 | 80.01 | 500/0 | 0.57 | 2.64 |
| compiled | tables-only | 250 | 25.95 | 28.74 | 250/0 | 0.57 | 2.64 |
| compiled | functions-only | 250 | 24.77 | 27.56 | 250/0 | 0.58 | 2.64 |
| compiled | both | 250 | 36.35 | 39.15 | 500/0 | 0.58 | 2.65 |
| zod-mini | tables-only | 250 | 26.08 | 28.88 | 250/0 | 0.58 | 2.64 |
| zod-mini | functions-only | 250 | 24.76 | 27.56 | 250/0 | 0.57 | 2.64 |
| zod-mini | both | 250 | 36.59 | 39.38 | 500/0 | 0.58 | 2.65 |

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