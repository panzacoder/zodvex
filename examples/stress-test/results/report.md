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
| zod | 166 | 386.0 |
| zod + slim | 219 | 291.8 |
| mini | 372 | 173.0 |
| mini + slim | 504 | 127.5 |

## All Measurements

| Variant | Count | Heap Delta (MB) | Peak (MB) | Modules |
|---------|-------|-----------------|-----------|---------|
| convex (baseline) | 500 | 12.59 | 13.95 | 1000 |
| convex (baseline) | 1000 | 24.49 | 25.84 | 2000 |
| convex (baseline) | 1500 | 36.70 | 38.05 | 3000 |
| convex (baseline) | 2000 | 48.65 | 50.00 | 4000 |
| convex (baseline) | 2500 | 61.29 | 62.64 | 5000 |
| convex (baseline) | 2563 | 62.79 | 64.14 | 5126 |
| convex (baseline) | 2594 | 63.52 | 64.87 | 5188 |
| convex (baseline) | 2610 | 63.89 | 65.24 | 5220 |
| convex (baseline) | 2614 | 63.99 | 65.34 | 5228 |
| convex (baseline) | 2618 | 64.09 | 65.43 | 5236 |
| convex (baseline) | 2625 | 64.24 | 65.60 | 5250 |
| convex (baseline) | 2750 | 67.23 | 68.57 | 5500 |
| convex (baseline) | 3000 | 73.34 | 74.69 | 6000 |
| convex-helpers/zod3 | 50 | 5.83 | 7.45 | 100 |
| convex-helpers/zod3 | 100 | 10.92 | 12.54 | 200 |
| convex-helpers/zod3 | 150 | 15.92 | 17.54 | 300 |
| convex-helpers/zod3 | 200 | 20.96 | 22.58 | 400 |
| convex-helpers/zod3 | 250 | 25.94 | 27.56 | 500 |
| convex-helpers/zod3 | 300 | 30.95 | 32.57 | 600 |
| convex-helpers/zod3 | 350 | 35.95 | 37.56 | 700 |
| convex-helpers/zod3 | 400 | 41.07 | 42.68 | 800 |
| convex-helpers/zod3 | 450 | 46.03 | 47.63 | 900 |
| convex-helpers/zod3 | 500 | 51.20 | 52.82 | 1000 |
| convex-helpers/zod3 | 550 | 56.21 | 57.82 | 1100 |
| convex-helpers/zod3 | 600 | 61.16 | 62.77 | 1200 |
| convex-helpers/zod3 | 625 | 63.67 | 65.29 | 1250 |
| convex-helpers/zod3 | 629 | 64.02 | 65.63 | 1258 |
| convex-helpers/zod3 | 632 | 64.37 | 65.99 | 1264 |
| convex-helpers/zod3 | 638 | 65.02 | 66.64 | 1276 |
| convex-helpers/zod3 | 650 | 66.12 | 67.74 | 1300 |
| convex-helpers/zod4 | 50 | 8.55 | 10.62 | 100 |
| convex-helpers/zod4 | 100 | 15.99 | 18.06 | 200 |
| convex-helpers/zod4 | 150 | 23.34 | 25.41 | 300 |
| convex-helpers/zod4 | 200 | 30.77 | 32.84 | 400 |
| convex-helpers/zod4 | 250 | 38.07 | 40.14 | 500 |
| convex-helpers/zod4 | 300 | 45.39 | 47.46 | 600 |
| convex-helpers/zod4 | 350 | 52.74 | 54.81 | 700 |
| convex-helpers/zod4 | 400 | 60.34 | 62.40 | 800 |
| convex-helpers/zod4 | 425 | 63.92 | 65.99 | 850 |
| convex-helpers/zod4 | 429 | 64.52 | 66.59 | 858 |
| convex-helpers/zod4 | 432 | 64.95 | 67.01 | 864 |
| convex-helpers/zod4 | 438 | 65.89 | 67.96 | 876 |
| convex-helpers/zod4 | 450 | 67.79 | 69.86 | 900 |
| zod | 50 | 20.03 | 22.51 | 100 |
| zod | 100 | 38.83 | 41.31 | 200 |
| zod | 150 | 57.56 | 60.03 | 300 |
| zod | 163 | 62.58 | 65.06 | 326 |
| zod | 166 | 63.81 | 66.29 | 332 |
| zod | 169 | 64.93 | 67.40 | 338 |
| zod | 175 | 66.98 | 69.46 | 350 |
| zod | 200 | 76.57 | 79.05 | 400 |
| zod + slim | 50 | 15.51 | 17.98 | 100 |
| zod + slim | 100 | 29.82 | 32.30 | 200 |
| zod + slim | 150 | 44.00 | 46.47 | 300 |
| zod + slim | 200 | 58.46 | 60.93 | 400 |
| zod + slim | 213 | 61.94 | 64.42 | 426 |
| zod + slim | 219 | 63.67 | 66.14 | 438 |
| zod + slim | 222 | 64.56 | 67.04 | 444 |
| zod + slim | 225 | 65.44 | 67.91 | 450 |
| zod + slim | 250 | 72.51 | 74.98 | 500 |
| mini | 50 | 9.48 | 11.79 | 100 |
| mini | 100 | 17.99 | 20.29 | 200 |
| mini | 150 | 26.41 | 28.72 | 300 |
| mini | 200 | 34.98 | 37.28 | 400 |
| mini | 250 | 43.25 | 45.56 | 500 |
| mini | 300 | 51.71 | 54.01 | 600 |
| mini | 350 | 60.22 | 62.52 | 700 |
| mini | 363 | 62.42 | 64.72 | 726 |
| mini | 369 | 63.46 | 65.76 | 738 |
| mini | 372 | 63.94 | 66.25 | 744 |
| mini | 375 | 64.51 | 66.82 | 750 |
| mini | 400 | 68.61 | 70.91 | 800 |
| mini + slim | 50 | 7.20 | 9.51 | 100 |
| mini + slim | 100 | 13.55 | 15.85 | 200 |
| mini + slim | 150 | 19.70 | 22.01 | 300 |
| mini + slim | 200 | 26.06 | 28.35 | 400 |
| mini + slim | 250 | 32.13 | 34.43 | 500 |
| mini + slim | 300 | 38.26 | 40.56 | 600 |
| mini + slim | 350 | 44.60 | 46.89 | 700 |
| mini + slim | 400 | 50.82 | 53.12 | 800 |
| mini + slim | 450 | 57.11 | 59.41 | 900 |
| mini + slim | 500 | 63.24 | 65.54 | 1000 |
| mini + slim | 504 | 63.69 | 65.99 | 1008 |
| mini + slim | 507 | 64.08 | 66.39 | 1014 |
| mini + slim | 513 | 64.89 | 67.19 | 1026 |
| mini + slim | 525 | 66.32 | 68.62 | 1050 |
| mini + slim | 550 | 69.46 | 71.76 | 1100 |