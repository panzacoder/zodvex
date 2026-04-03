# Zod v4 OOM Stress Test Results

**Date:** 2026-04-03
**Scale points:** 50, 100, 150, 200, 250
**Variants:** baseline, compiled, zod-mini

## Import Baselines (memory floor before any user schemas)

| Package | Heap Delta (MB) |
|---------|----------------|
| zod | 0.75 |
| zod/mini | 0.70 |

## Results

| Variant | Mode | Count | Heap Delta (MB) | Peak Heap (MB) | Loaded/Failed | Convex-Only Delta (MB) | Convex-Only Peak (MB) |
|---------|------|-------|----------------|---------------|--------------|----------------------|---------------------|
| baseline | tables-only | 50 | 12.27 | 14.99 | 50/0 | 0.20 | 2.25 |
| baseline | functions-only | 50 | 11.36 | 14.07 | 50/0 | 0.21 | 2.25 |
| baseline | both | 50 | 16.82 | 19.54 | 100/0 | 0.21 | 2.26 |
| compiled | tables-only | 50 | 5.80 | 8.51 | 50/0 | 0.20 | 2.25 |
| compiled | functions-only | 50 | 5.98 | 8.69 | 50/0 | 0.20 | 2.24 |
| compiled | both | 50 | 8.69 | 11.40 | 100/0 | 0.21 | 2.25 |
| zod-mini | tables-only | 50 | 5.80 | 8.51 | 50/0 | 0.20 | 2.25 |
| zod-mini | functions-only | 50 | 5.98 | 8.69 | 50/0 | 0.20 | 2.25 |
| zod-mini | both | 50 | 8.69 | 11.39 | 100/0 | 0.20 | 2.25 |
| baseline | tables-only | 100 | 24.03 | 26.76 | 100/0 | 0.31 | 2.36 |
| baseline | functions-only | 100 | 22.37 | 25.09 | 100/0 | 0.31 | 2.36 |
| baseline | both | 100 | 32.90 | 35.63 | 200/0 | 0.31 | 2.36 |
| compiled | tables-only | 100 | 10.95 | 13.68 | 100/0 | 0.31 | 2.36 |
| compiled | functions-only | 100 | 11.50 | 14.22 | 100/0 | 0.32 | 2.36 |
| compiled | both | 100 | 16.50 | 19.23 | 200/0 | 0.32 | 2.35 |
| zod-mini | tables-only | 100 | 10.98 | 13.70 | 100/0 | 0.32 | 2.36 |
| zod-mini | functions-only | 100 | 11.48 | 14.21 | 100/0 | 0.31 | 2.35 |
| zod-mini | both | 100 | 16.49 | 19.23 | 200/0 | 0.32 | 2.36 |
| baseline | tables-only | 150 | 35.49 | 38.23 | 150/0 | 0.40 | 2.44 |
| baseline | functions-only | 150 | 32.94 | 35.68 | 150/0 | 0.40 | 2.44 |
| baseline | both | 150 | 48.56 | 51.31 | 300/0 | 0.40 | 2.44 |
| compiled | tables-only | 150 | 16.02 | 18.76 | 150/0 | 0.41 | 2.45 |
| compiled | functions-only | 150 | 16.72 | 19.46 | 150/0 | 0.40 | 2.44 |
| compiled | both | 150 | 24.10 | 26.83 | 300/0 | 0.40 | 2.44 |
| zod-mini | tables-only | 150 | 16.03 | 18.77 | 150/0 | 0.40 | 2.44 |
| zod-mini | functions-only | 150 | 16.70 | 19.44 | 150/0 | 0.40 | 2.45 |
| zod-mini | both | 150 | 24.08 | 26.82 | 300/0 | 0.40 | 2.44 |
| baseline | tables-only | 200 | 47.17 | 49.92 | 200/0 | 0.49 | 2.53 |
| baseline | functions-only | 200 | 43.84 | 46.58 | 200/0 | 0.49 | 2.53 |
| baseline | both | 200 | 64.53 | 67.27 | 400/0 | 0.49 | 2.53 |
| compiled | tables-only | 200 | 21.14 | 23.89 | 200/0 | 0.49 | 2.54 |
| compiled | functions-only | 200 | 22.11 | 24.84 | 200/0 | 0.49 | 2.53 |
| compiled | both | 200 | 31.74 | 34.49 | 400/0 | 0.49 | 2.53 |
| zod-mini | tables-only | 200 | 21.14 | 23.88 | 200/0 | 0.49 | 2.53 |
| zod-mini | functions-only | 200 | 22.07 | 24.81 | 200/0 | 0.49 | 2.53 |
| zod-mini | both | 200 | 31.73 | 34.47 | 400/0 | 0.49 | 2.53 |
| baseline | tables-only | 250 | 58.52 | 61.28 | 250/0 | 0.57 | 2.61 |
| baseline | functions-only | 250 | 54.43 | 57.17 | 250/0 | 0.58 | 2.62 |
| baseline | both | 250 | 80.13 | 82.88 | 500/0 | 0.58 | 2.62 |
| compiled | tables-only | 250 | 26.10 | 28.85 | 250/0 | 0.58 | 2.62 |
| compiled | functions-only | 250 | 27.34 | 30.09 | 250/0 | 0.58 | 2.62 |
| compiled | both | 250 | 39.28 | 42.03 | 500/0 | 0.58 | 2.62 |
| zod-mini | tables-only | 250 | 26.12 | 28.86 | 250/0 | 0.58 | 2.62 |
| zod-mini | functions-only | 250 | 27.30 | 30.04 | 250/0 | 0.58 | 2.62 |
| zod-mini | both | 250 | 39.28 | 42.03 | 500/0 | 0.58 | 2.62 |

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