# Zod v4 OOM Stress Test Results

**Date:** 2026-04-02
**Scale points:** 50, 100, 150, 200, 250
**Variants:** baseline, zod-mini

## Import Baselines (memory floor before any user schemas)

| Package | Heap Delta (MB) |
|---------|----------------|
| zod | 0.75 |
| zod/mini | 0.70 |

## Results

| Variant | Mode | Count | Heap Delta (MB) | Peak Heap (MB) | Loaded/Failed | Convex-Only Delta (MB) | Convex-Only Peak (MB) |
|---------|------|-------|----------------|---------------|--------------|----------------------|---------------------|
| baseline | tables-only | 50 | 13.02 | 15.73 | 50/0 | 0.20 | 2.25 |
| baseline | functions-only | 50 | 12.11 | 14.82 | 50/0 | 0.21 | 2.26 |
| baseline | both | 50 | 18.10 | 20.82 | 100/0 | 0.21 | 2.25 |
| zod-mini | tables-only | 50 | 10.84 | 13.56 | 50/0 | 0.21 | 2.25 |
| zod-mini | functions-only | 50 | 9.09 | 11.81 | 50/0 | 0.21 | 2.25 |
| zod-mini | both | 50 | 15.40 | 18.11 | 100/0 | 0.21 | 2.25 |
| baseline | tables-only | 100 | 25.53 | 28.26 | 100/0 | 0.31 | 2.35 |
| baseline | functions-only | 100 | 23.86 | 26.59 | 100/0 | 0.32 | 2.36 |
| baseline | both | 100 | 35.48 | 38.21 | 200/0 | 0.32 | 2.36 |
| zod-mini | tables-only | 100 | 20.98 | 23.71 | 100/0 | 0.32 | 2.35 |
| zod-mini | functions-only | 100 | 17.61 | 20.34 | 100/0 | 0.32 | 2.35 |
| zod-mini | both | 100 | 29.84 | 32.57 | 200/0 | 0.31 | 2.36 |
| baseline | tables-only | 150 | 37.75 | 40.49 | 150/0 | 0.40 | 2.44 |
| baseline | functions-only | 150 | 35.21 | 37.94 | 150/0 | 0.40 | 2.44 |
| baseline | both | 150 | 52.44 | 55.18 | 300/0 | 0.40 | 2.44 |
| zod-mini | tables-only | 150 | 30.93 | 33.67 | 150/0 | 0.40 | 2.44 |
| zod-mini | functions-only | 150 | 25.84 | 28.58 | 150/0 | 0.40 | 2.44 |
| zod-mini | both | 150 | 43.99 | 46.73 | 300/0 | 0.40 | 2.44 |
| baseline | tables-only | 200 | 50.18 | 52.92 | 200/0 | 0.49 | 2.53 |
| baseline | functions-only | 200 | 46.86 | 49.60 | 200/0 | 0.49 | 2.53 |
| baseline | both | 200 | 69.68 | 72.43 | 400/0 | 0.49 | 2.53 |
| zod-mini | tables-only | 200 | 40.96 | 43.71 | 200/0 | 0.49 | 2.53 |
| zod-mini | functions-only | 200 | 34.23 | 36.98 | 200/0 | 0.49 | 2.53 |
| zod-mini | both | 200 | 58.26 | 61.00 | 400/0 | 0.49 | 2.53 |
| baseline | tables-only | 250 | 62.29 | 65.04 | 250/0 | 0.58 | 2.62 |
| baseline | functions-only | 250 | 58.17 | 60.92 | 250/0 | 0.58 | 2.62 |
| baseline | both | 250 | 86.65 | 89.40 | 500/0 | 0.58 | 2.62 |
| zod-mini | tables-only | 250 | 50.77 | 53.52 | 250/0 | 0.58 | 2.62 |
| zod-mini | functions-only | 250 | 42.44 | 45.18 | 250/0 | 0.57 | 2.61 |
| zod-mini | both | 250 | 72.40 | 75.15 | 500/0 | 0.58 | 2.62 |

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