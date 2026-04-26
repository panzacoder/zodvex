# Stress Test Report

**Date:** 2026-04-26
**Budget:** 64 MB

## OOM Ceilings

`per-endpoint` is the slope between the smallest and largest passing
measurements — the incremental cost of adding one model. Heap at the
ceiling itself is always ≈ budget by construction, so it's omitted here.

| Variant | Max Endpoints | Per-endpoint (KB) |
|---------|--------------|-------------------|
| convex (baseline) | 2606 | 24.9 |
| convex-helpers/zod3 | 629 | 102.9 |
| convex-helpers/zod4 | 425 | 151.7 |
| zod | 179 | 357.9 |
| zod + codegen | 179 | 358.0 |
| zod + slim | 241 | 263.9 |
| mini | 394 | 163.0 |
| mini + slim | 547 | 117.6 |

## All Measurements

| Variant | Count | Heap Delta (MB) | Peak (MB) | Modules |
|---------|-------|-----------------|-----------|---------|
| convex (baseline) | 500 | 12.60 | 13.94 | 1000 |
| convex (baseline) | 1000 | 24.49 | 25.83 | 2000 |
| convex (baseline) | 1500 | 36.71 | 38.05 | 3000 |
| convex (baseline) | 2000 | 48.66 | 50.01 | 4000 |
| convex (baseline) | 2500 | 61.43 | 62.77 | 5000 |
| convex (baseline) | 2563 | 62.92 | 64.26 | 5126 |
| convex (baseline) | 2594 | 63.67 | 65.01 | 5188 |
| convex (baseline) | 2602 | 63.85 | 65.19 | 5204 |
| convex (baseline) | 2606 | 63.95 | 65.29 | 5212 |
| convex (baseline) | 2610 | 64.04 | 65.38 | 5220 |
| convex (baseline) | 2625 | 64.39 | 65.74 | 5250 |
| convex (baseline) | 2750 | 67.38 | 68.72 | 5500 |
| convex (baseline) | 3000 | 73.36 | 74.71 | 6000 |
| convex-helpers/zod3 | 50 | 5.82 | 7.43 | 100 |
| convex-helpers/zod3 | 100 | 10.90 | 12.51 | 200 |
| convex-helpers/zod3 | 150 | 15.91 | 17.52 | 300 |
| convex-helpers/zod3 | 200 | 20.95 | 22.56 | 400 |
| convex-helpers/zod3 | 250 | 25.93 | 27.55 | 500 |
| convex-helpers/zod3 | 300 | 30.93 | 32.55 | 600 |
| convex-helpers/zod3 | 350 | 35.93 | 37.54 | 700 |
| convex-helpers/zod3 | 400 | 41.05 | 42.66 | 800 |
| convex-helpers/zod3 | 450 | 46.00 | 47.62 | 900 |
| convex-helpers/zod3 | 500 | 51.19 | 52.81 | 1000 |
| convex-helpers/zod3 | 550 | 56.20 | 57.81 | 1100 |
| convex-helpers/zod3 | 600 | 61.16 | 62.77 | 1200 |
| convex-helpers/zod3 | 625 | 63.67 | 65.28 | 1250 |
| convex-helpers/zod3 | 629 | 64.00 | 65.62 | 1258 |
| convex-helpers/zod3 | 632 | 64.36 | 65.98 | 1264 |
| convex-helpers/zod3 | 638 | 65.01 | 66.62 | 1276 |
| convex-helpers/zod3 | 650 | 66.11 | 67.72 | 1300 |
| convex-helpers/zod4 | 50 | 8.53 | 10.59 | 100 |
| convex-helpers/zod4 | 100 | 15.97 | 18.04 | 200 |
| convex-helpers/zod4 | 150 | 23.32 | 25.39 | 300 |
| convex-helpers/zod4 | 200 | 30.75 | 32.81 | 400 |
| convex-helpers/zod4 | 250 | 38.05 | 40.11 | 500 |
| convex-helpers/zod4 | 300 | 45.37 | 47.43 | 600 |
| convex-helpers/zod4 | 350 | 52.71 | 54.78 | 700 |
| convex-helpers/zod4 | 400 | 60.32 | 62.38 | 800 |
| convex-helpers/zod4 | 425 | 63.90 | 65.97 | 850 |
| convex-helpers/zod4 | 429 | 64.51 | 66.57 | 858 |
| convex-helpers/zod4 | 432 | 64.93 | 66.99 | 864 |
| convex-helpers/zod4 | 438 | 65.87 | 67.94 | 876 |
| convex-helpers/zod4 | 450 | 67.78 | 69.84 | 900 |
| zod | 50 | 18.65 | 21.11 | 100 |
| zod | 100 | 36.07 | 38.53 | 200 |
| zod | 150 | 53.42 | 55.89 | 300 |
| zod | 175 | 62.15 | 64.62 | 350 |
| zod | 179 | 63.83 | 66.30 | 358 |
| zod | 182 | 64.57 | 67.04 | 364 |
| zod | 188 | 66.71 | 69.18 | 376 |
| zod | 200 | 71.07 | 73.54 | 400 |
| zod + codegen | 50 | 18.63 | 21.10 | 100 |
| zod + codegen | 100 | 36.07 | 38.53 | 200 |
| zod + codegen | 150 | 53.42 | 55.89 | 300 |
| zod + codegen | 175 | 62.14 | 64.62 | 350 |
| zod + codegen | 179 | 63.83 | 66.30 | 358 |
| zod + codegen | 182 | 64.57 | 67.04 | 364 |
| zod + codegen | 188 | 66.71 | 69.18 | 376 |
| zod + codegen | 200 | 71.07 | 73.54 | 400 |
| zod + slim | 50 | 14.13 | 16.61 | 100 |
| zod + slim | 100 | 27.05 | 29.52 | 200 |
| zod + slim | 150 | 39.86 | 42.32 | 300 |
| zod + slim | 200 | 52.99 | 55.46 | 400 |
| zod + slim | 225 | 59.32 | 61.80 | 450 |
| zod + slim | 238 | 62.44 | 64.92 | 476 |
| zod + slim | 241 | 63.30 | 65.76 | 482 |
| zod + slim | 244 | 64.02 | 66.50 | 488 |
| zod + slim | 250 | 65.67 | 68.14 | 500 |
| mini | 50 | 8.95 | 11.25 | 100 |
| mini | 100 | 16.98 | 19.27 | 200 |
| mini | 150 | 24.91 | 27.20 | 300 |
| mini | 200 | 32.97 | 35.27 | 400 |
| mini | 250 | 40.78 | 43.07 | 500 |
| mini | 300 | 48.71 | 51.01 | 600 |
| mini | 350 | 56.77 | 59.07 | 700 |
| mini | 375 | 60.80 | 63.09 | 750 |
| mini | 388 | 62.73 | 65.02 | 776 |
| mini | 394 | 63.69 | 65.99 | 788 |
| mini | 397 | 64.19 | 66.49 | 794 |
| mini | 400 | 64.66 | 66.95 | 800 |
| mini + slim | 50 | 6.73 | 9.02 | 100 |
| mini + slim | 100 | 12.55 | 14.85 | 200 |
| mini + slim | 150 | 18.20 | 20.51 | 300 |
| mini + slim | 200 | 24.12 | 26.41 | 400 |
| mini + slim | 250 | 29.69 | 31.98 | 500 |
| mini + slim | 300 | 35.34 | 37.63 | 600 |
| mini + slim | 350 | 41.19 | 43.48 | 700 |
| mini + slim | 400 | 47.01 | 49.30 | 800 |
| mini + slim | 450 | 52.80 | 55.09 | 900 |
| mini + slim | 500 | 58.40 | 60.70 | 1000 |
| mini + slim | 525 | 61.24 | 63.53 | 1050 |
| mini + slim | 538 | 62.72 | 65.01 | 1076 |
| mini + slim | 544 | 63.43 | 65.73 | 1088 |
| mini + slim | 547 | 63.78 | 66.07 | 1094 |
| mini + slim | 550 | 64.14 | 66.43 | 1100 |