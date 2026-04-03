# Zod v4 OOM Stress Test Results

**Date:** 2026-04-03
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
| baseline | tables-only | 50 | 12.28 | 14.99 | 50/0 | 0.20 | 2.25 |
| baseline | functions-only | 50 | 11.35 | 14.07 | 50/0 | 0.20 | 2.25 |
| baseline | both | 50 | 16.83 | 19.53 | 100/0 | 0.20 | 2.25 |
| zod-mini | tables-only | 50 | 5.80 | 8.51 | 50/0 | 0.21 | 2.25 |
| zod-mini | functions-only | 50 | 5.98 | 8.69 | 50/0 | 0.20 | 2.25 |
| zod-mini | both | 50 | 8.69 | 11.39 | 100/0 | 0.20 | 2.25 |
| baseline | tables-only | 100 | 24.03 | 26.76 | 100/0 | 0.32 | 2.36 |
| baseline | functions-only | 100 | 22.37 | 25.10 | 100/0 | 0.31 | 2.36 |
| baseline | both | 100 | 32.90 | 35.63 | 200/0 | 0.32 | 2.36 |
| zod-mini | tables-only | 100 | 10.95 | 13.68 | 100/0 | 0.31 | 2.35 |
| zod-mini | functions-only | 100 | 11.48 | 14.21 | 100/0 | 0.31 | 2.35 |
| zod-mini | both | 100 | 16.47 | 19.20 | 200/0 | 0.31 | 2.36 |
| baseline | tables-only | 150 | 35.49 | 38.22 | 150/0 | 0.40 | 2.45 |
| baseline | functions-only | 150 | 32.95 | 35.68 | 150/0 | 0.39 | 2.44 |
| baseline | both | 150 | 48.57 | 51.30 | 300/0 | 0.40 | 2.44 |
| zod-mini | tables-only | 150 | 16.00 | 18.74 | 150/0 | 0.40 | 2.44 |
| zod-mini | functions-only | 150 | 16.70 | 19.44 | 150/0 | 0.40 | 2.45 |
| zod-mini | both | 150 | 24.05 | 26.79 | 300/0 | 0.40 | 2.44 |
| baseline | tables-only | 200 | 47.16 | 49.90 | 200/0 | 0.49 | 2.53 |
| baseline | functions-only | 200 | 43.82 | 46.57 | 200/0 | 0.49 | 2.53 |
| baseline | both | 200 | 64.50 | 67.25 | 400/0 | 0.48 | 2.53 |
| zod-mini | tables-only | 200 | 21.10 | 23.85 | 200/0 | 0.49 | 2.53 |
| zod-mini | functions-only | 200 | 22.07 | 24.81 | 200/0 | 0.49 | 2.53 |
| zod-mini | both | 200 | 31.67 | 34.42 | 400/0 | 0.49 | 2.53 |
| baseline | tables-only | 250 | 58.53 | 61.27 | 250/0 | 0.57 | 2.62 |
| baseline | functions-only | 250 | 54.42 | 57.16 | 250/0 | 0.58 | 2.62 |
| baseline | both | 250 | 80.13 | 82.87 | 500/0 | 0.58 | 2.62 |
| zod-mini | tables-only | 250 | 26.05 | 28.80 | 250/0 | 0.58 | 2.62 |
| zod-mini | functions-only | 250 | 27.30 | 30.04 | 250/0 | 0.58 | 2.62 |
| zod-mini | both | 250 | 39.24 | 41.98 | 500/0 | 0.57 | 2.62 |

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