# Stress Test Report

**Date:** 2026-04-24
**Budget:** 64 MB

## OOM Ceilings

`per-endpoint` is the slope between the smallest and largest passing
measurements — the incremental cost of adding one model. Heap at the
ceiling itself is always ≈ budget by construction, so it's omitted here.

| Variant | Max Endpoints | Per-endpoint (KB) |
|---------|--------------|-------------------|
| convex (baseline) | 2614 | 24.9 |
| convex-helpers/zod3 | 625 | 102.9 |
| convex-helpers/zod4 | 425 | 151.7 |
| zod | 179 | 357.9 |
| zod + slim | 241 | 263.9 |
| mini | 394 | 162.9 |
| mini + slim | 547 | 117.4 |

## All Measurements

| Variant | Count | Heap Delta (MB) | Peak (MB) | Modules |
|---------|-------|-----------------|-----------|---------|
| convex (baseline) | 500 | 12.59 | 13.95 | 1000 |
| convex (baseline) | 1000 | 24.48 | 25.83 | 2000 |
| convex (baseline) | 1500 | 36.69 | 38.04 | 3000 |
| convex (baseline) | 2000 | 48.66 | 50.00 | 4000 |
| convex (baseline) | 2500 | 61.28 | 62.64 | 5000 |
| convex (baseline) | 2563 | 62.91 | 64.26 | 5126 |
| convex (baseline) | 2594 | 63.52 | 64.87 | 5188 |
| convex (baseline) | 2610 | 63.90 | 65.24 | 5220 |
| convex (baseline) | 2614 | 64.00 | 65.35 | 5228 |
| convex (baseline) | 2618 | 64.20 | 65.55 | 5236 |
| convex (baseline) | 2625 | 64.37 | 65.72 | 5250 |
| convex (baseline) | 2750 | 67.23 | 68.58 | 5500 |
| convex (baseline) | 3000 | 73.32 | 74.68 | 6000 |
| convex-helpers/zod3 | 50 | 5.83 | 7.45 | 100 |
| convex-helpers/zod3 | 100 | 10.92 | 12.53 | 200 |
| convex-helpers/zod3 | 150 | 15.93 | 17.54 | 300 |
| convex-helpers/zod3 | 200 | 20.96 | 22.58 | 400 |
| convex-helpers/zod3 | 250 | 25.95 | 27.56 | 500 |
| convex-helpers/zod3 | 300 | 30.95 | 32.57 | 600 |
| convex-helpers/zod3 | 350 | 35.94 | 37.56 | 700 |
| convex-helpers/zod3 | 400 | 41.06 | 42.68 | 800 |
| convex-helpers/zod3 | 450 | 46.02 | 47.63 | 900 |
| convex-helpers/zod3 | 500 | 51.20 | 52.82 | 1000 |
| convex-helpers/zod3 | 550 | 56.20 | 57.82 | 1100 |
| convex-helpers/zod3 | 600 | 61.16 | 62.77 | 1200 |
| convex-helpers/zod3 | 625 | 63.67 | 65.29 | 1250 |
| convex-helpers/zod3 | 629 | 64.01 | 65.62 | 1258 |
| convex-helpers/zod3 | 632 | 64.38 | 65.99 | 1264 |
| convex-helpers/zod3 | 638 | 65.02 | 66.64 | 1276 |
| convex-helpers/zod3 | 650 | 66.13 | 67.73 | 1300 |
| convex-helpers/zod4 | 50 | 8.55 | 10.62 | 100 |
| convex-helpers/zod4 | 100 | 15.99 | 18.06 | 200 |
| convex-helpers/zod4 | 150 | 23.34 | 25.41 | 300 |
| convex-helpers/zod4 | 200 | 30.77 | 32.84 | 400 |
| convex-helpers/zod4 | 250 | 38.07 | 40.14 | 500 |
| convex-helpers/zod4 | 300 | 45.39 | 47.46 | 600 |
| convex-helpers/zod4 | 350 | 52.73 | 54.81 | 700 |
| convex-helpers/zod4 | 400 | 60.34 | 62.41 | 800 |
| convex-helpers/zod4 | 425 | 63.92 | 65.99 | 850 |
| convex-helpers/zod4 | 429 | 64.52 | 66.59 | 858 |
| convex-helpers/zod4 | 432 | 64.95 | 67.02 | 864 |
| convex-helpers/zod4 | 438 | 65.89 | 67.96 | 876 |
| convex-helpers/zod4 | 450 | 67.79 | 69.86 | 900 |
| zod | 50 | 18.68 | 21.16 | 100 |
| zod | 100 | 36.10 | 38.57 | 200 |
| zod | 150 | 53.45 | 55.92 | 300 |
| zod | 175 | 62.20 | 64.67 | 350 |
| zod | 179 | 63.88 | 66.35 | 358 |
| zod | 182 | 64.59 | 67.07 | 364 |
| zod | 188 | 66.73 | 69.21 | 376 |
| zod | 200 | 71.11 | 73.58 | 400 |
| zod + slim | 50 | 14.12 | 16.60 | 100 |
| zod + slim | 100 | 27.09 | 29.56 | 200 |
| zod + slim | 150 | 39.90 | 42.36 | 300 |
| zod + slim | 200 | 52.96 | 55.44 | 400 |
| zod + slim | 225 | 59.29 | 61.76 | 450 |
| zod + slim | 238 | 62.43 | 64.91 | 476 |
| zod + slim | 241 | 63.28 | 65.76 | 482 |
| zod + slim | 244 | 64.02 | 66.49 | 488 |
| zod + slim | 250 | 65.66 | 68.13 | 500 |
| mini | 50 | 9.01 | 11.30 | 100 |
| mini | 100 | 17.00 | 19.30 | 200 |
| mini | 150 | 24.93 | 27.24 | 300 |
| mini | 200 | 33.01 | 35.31 | 400 |
| mini | 250 | 40.78 | 43.09 | 500 |
| mini | 300 | 48.73 | 51.04 | 600 |
| mini | 350 | 56.78 | 59.08 | 700 |
| mini | 375 | 60.82 | 63.12 | 750 |
| mini | 388 | 62.77 | 65.07 | 776 |
| mini | 394 | 63.70 | 66.00 | 788 |
| mini | 397 | 64.21 | 66.51 | 794 |
| mini | 400 | 64.69 | 67.00 | 800 |
| mini + slim | 50 | 6.73 | 9.04 | 100 |
| mini + slim | 100 | 12.57 | 14.87 | 200 |
| mini + slim | 150 | 18.24 | 20.54 | 300 |
| mini + slim | 200 | 24.08 | 26.38 | 400 |
| mini + slim | 250 | 29.68 | 31.98 | 500 |
| mini + slim | 300 | 35.30 | 37.61 | 600 |
| mini + slim | 350 | 41.16 | 43.46 | 700 |
| mini + slim | 400 | 46.90 | 49.20 | 800 |
| mini + slim | 450 | 52.68 | 54.99 | 900 |
| mini + slim | 500 | 58.33 | 60.64 | 1000 |
| mini + slim | 525 | 61.16 | 63.47 | 1050 |
| mini + slim | 538 | 62.63 | 64.94 | 1076 |
| mini + slim | 544 | 63.36 | 65.65 | 1088 |
| mini + slim | 547 | 63.69 | 65.99 | 1094 |
| mini + slim | 550 | 64.06 | 66.37 | 1100 |