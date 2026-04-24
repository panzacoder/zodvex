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
| zod + slim | 241 | 263.8 |
| mini | 394 | 163.0 |
| mini + slim | 547 | 117.6 |

## All Measurements

| Variant | Count | Heap Delta (MB) | Peak (MB) | Modules |
|---------|-------|-----------------|-----------|---------|
| convex (baseline) | 500 | 12.60 | 13.95 | 1000 |
| convex (baseline) | 1000 | 24.48 | 25.84 | 2000 |
| convex (baseline) | 1500 | 36.68 | 38.04 | 3000 |
| convex (baseline) | 2000 | 48.64 | 50.00 | 4000 |
| convex (baseline) | 2500 | 61.28 | 62.63 | 5000 |
| convex (baseline) | 2563 | 62.79 | 64.14 | 5126 |
| convex (baseline) | 2594 | 63.52 | 64.87 | 5188 |
| convex (baseline) | 2610 | 63.88 | 65.24 | 5220 |
| convex (baseline) | 2614 | 64.00 | 65.35 | 5228 |
| convex (baseline) | 2618 | 64.21 | 65.56 | 5236 |
| convex (baseline) | 2625 | 64.24 | 65.60 | 5250 |
| convex (baseline) | 2750 | 67.21 | 68.57 | 5500 |
| convex (baseline) | 3000 | 73.34 | 74.68 | 6000 |
| convex-helpers/zod3 | 50 | 5.83 | 7.45 | 100 |
| convex-helpers/zod3 | 100 | 10.92 | 12.54 | 200 |
| convex-helpers/zod3 | 150 | 15.93 | 17.54 | 300 |
| convex-helpers/zod3 | 200 | 20.96 | 22.58 | 400 |
| convex-helpers/zod3 | 250 | 25.95 | 27.56 | 500 |
| convex-helpers/zod3 | 300 | 30.95 | 32.56 | 600 |
| convex-helpers/zod3 | 350 | 35.94 | 37.56 | 700 |
| convex-helpers/zod3 | 400 | 41.06 | 42.67 | 800 |
| convex-helpers/zod3 | 450 | 46.02 | 47.63 | 900 |
| convex-helpers/zod3 | 500 | 51.20 | 52.82 | 1000 |
| convex-helpers/zod3 | 550 | 56.20 | 57.82 | 1100 |
| convex-helpers/zod3 | 600 | 61.16 | 62.78 | 1200 |
| convex-helpers/zod3 | 625 | 63.67 | 65.29 | 1250 |
| convex-helpers/zod3 | 629 | 64.01 | 65.63 | 1258 |
| convex-helpers/zod3 | 632 | 64.37 | 65.99 | 1264 |
| convex-helpers/zod3 | 638 | 65.02 | 66.64 | 1276 |
| convex-helpers/zod3 | 650 | 66.12 | 67.73 | 1300 |
| convex-helpers/zod4 | 50 | 8.55 | 10.62 | 100 |
| convex-helpers/zod4 | 100 | 15.99 | 18.06 | 200 |
| convex-helpers/zod4 | 150 | 23.34 | 25.41 | 300 |
| convex-helpers/zod4 | 200 | 30.77 | 32.84 | 400 |
| convex-helpers/zod4 | 250 | 38.07 | 40.14 | 500 |
| convex-helpers/zod4 | 300 | 45.39 | 47.46 | 600 |
| convex-helpers/zod4 | 350 | 52.74 | 54.80 | 700 |
| convex-helpers/zod4 | 400 | 60.34 | 62.41 | 800 |
| convex-helpers/zod4 | 425 | 63.91 | 65.98 | 850 |
| convex-helpers/zod4 | 429 | 64.52 | 66.59 | 858 |
| convex-helpers/zod4 | 432 | 64.95 | 67.02 | 864 |
| convex-helpers/zod4 | 438 | 65.89 | 67.96 | 876 |
| convex-helpers/zod4 | 450 | 67.79 | 69.86 | 900 |
| zod | 50 | 18.69 | 21.16 | 100 |
| zod | 100 | 36.09 | 38.57 | 200 |
| zod | 150 | 53.45 | 55.93 | 300 |
| zod | 175 | 62.18 | 64.66 | 350 |
| zod | 179 | 63.86 | 66.34 | 358 |
| zod | 182 | 64.62 | 67.09 | 364 |
| zod | 188 | 66.75 | 69.23 | 376 |
| zod | 200 | 71.12 | 73.60 | 400 |
| zod + slim | 50 | 14.18 | 16.65 | 100 |
| zod + slim | 100 | 27.08 | 29.55 | 200 |
| zod + slim | 150 | 39.89 | 42.37 | 300 |
| zod + slim | 200 | 53.03 | 55.51 | 400 |
| zod + slim | 225 | 59.35 | 61.82 | 450 |
| zod + slim | 238 | 62.48 | 64.95 | 476 |
| zod + slim | 241 | 63.32 | 65.80 | 482 |
| zod + slim | 244 | 64.07 | 66.54 | 488 |
| zod + slim | 250 | 65.70 | 68.18 | 500 |
| mini | 50 | 8.99 | 11.29 | 100 |
| mini | 100 | 17.01 | 19.30 | 200 |
| mini | 150 | 24.94 | 27.24 | 300 |
| mini | 200 | 33.01 | 35.32 | 400 |
| mini | 250 | 40.77 | 43.07 | 500 |
| mini | 300 | 48.73 | 51.04 | 600 |
| mini | 350 | 56.80 | 59.10 | 700 |
| mini | 375 | 60.82 | 63.12 | 750 |
| mini | 388 | 62.75 | 65.05 | 776 |
| mini | 394 | 63.70 | 66.00 | 788 |
| mini | 397 | 64.22 | 66.52 | 794 |
| mini | 400 | 64.69 | 66.99 | 800 |
| mini + slim | 50 | 6.76 | 9.07 | 100 |
| mini + slim | 100 | 12.58 | 14.88 | 200 |
| mini + slim | 150 | 18.23 | 20.54 | 300 |
| mini + slim | 200 | 24.13 | 26.43 | 400 |
| mini + slim | 250 | 29.73 | 32.02 | 500 |
| mini + slim | 300 | 35.37 | 37.67 | 600 |
| mini + slim | 350 | 41.21 | 43.51 | 700 |
| mini + slim | 400 | 47.03 | 49.33 | 800 |
| mini + slim | 450 | 52.81 | 55.12 | 900 |
| mini + slim | 500 | 58.41 | 60.72 | 1000 |
| mini + slim | 525 | 61.26 | 63.56 | 1050 |
| mini + slim | 538 | 62.73 | 65.04 | 1076 |
| mini + slim | 544 | 63.44 | 65.75 | 1088 |
| mini + slim | 547 | 63.80 | 66.10 | 1094 |
| mini + slim | 550 | 64.16 | 66.46 | 1100 |