# Stress Test Report

**Date:** 2026-04-24
**Budget:** 64 MB

## OOM Ceilings

| Variant | Max Endpoints | Heap at Ceiling (MB) |
|---------|--------------|---------------------|
| convex (baseline) | 2614 | 63.99 |
| convex-helpers/zod4 | 425 | 63.91 |
| zod | 166 | 63.81 |
| zod + slim | 219 | 63.66 |
| mini | 372 | 63.96 |
| mini + slim | 504 | 63.69 |

## All Measurements

| Variant | Count | Heap Delta (MB) | Peak (MB) | Modules |
|---------|-------|-----------------|-----------|---------|
| convex (baseline) | 500 | 12.60 | 13.94 | 1000 |
| convex (baseline) | 1000 | 24.48 | 25.83 | 2000 |
| convex (baseline) | 1500 | 36.71 | 38.06 | 3000 |
| convex (baseline) | 2000 | 48.65 | 49.99 | 4000 |
| convex (baseline) | 2500 | 61.38 | 62.72 | 5000 |
| convex (baseline) | 2563 | 62.78 | 64.12 | 5126 |
| convex (baseline) | 2594 | 63.64 | 64.99 | 5188 |
| convex (baseline) | 2610 | 63.88 | 65.23 | 5220 |
| convex (baseline) | 2614 | 63.99 | 65.34 | 5228 |
| convex (baseline) | 2618 | 64.08 | 65.42 | 5236 |
| convex (baseline) | 2625 | 64.36 | 65.71 | 5250 |
| convex (baseline) | 2750 | 67.22 | 68.57 | 5500 |
| convex (baseline) | 3000 | 73.33 | 74.67 | 6000 |
| convex-helpers/zod4 | 50 | 8.55 | 10.61 | 100 |
| convex-helpers/zod4 | 100 | 15.98 | 18.05 | 200 |
| convex-helpers/zod4 | 150 | 23.34 | 25.40 | 300 |
| convex-helpers/zod4 | 200 | 30.76 | 32.83 | 400 |
| convex-helpers/zod4 | 250 | 38.07 | 40.13 | 500 |
| convex-helpers/zod4 | 300 | 45.38 | 47.45 | 600 |
| convex-helpers/zod4 | 350 | 52.73 | 54.80 | 700 |
| convex-helpers/zod4 | 400 | 60.33 | 62.40 | 800 |
| convex-helpers/zod4 | 425 | 63.91 | 65.98 | 850 |
| convex-helpers/zod4 | 429 | 64.52 | 66.59 | 858 |
| convex-helpers/zod4 | 432 | 64.94 | 67.01 | 864 |
| convex-helpers/zod4 | 438 | 65.89 | 67.96 | 876 |
| convex-helpers/zod4 | 450 | 67.79 | 69.85 | 900 |
| zod | 50 | 20.04 | 22.52 | 100 |
| zod | 100 | 38.85 | 41.31 | 200 |
| zod | 150 | 57.55 | 60.03 | 300 |
| zod | 163 | 62.57 | 65.04 | 326 |
| zod | 166 | 63.81 | 66.29 | 332 |
| zod | 169 | 64.92 | 67.40 | 338 |
| zod | 175 | 66.98 | 69.45 | 350 |
| zod | 200 | 76.57 | 79.04 | 400 |
| zod + slim | 50 | 15.49 | 17.97 | 100 |
| zod + slim | 100 | 29.82 | 32.29 | 200 |
| zod + slim | 150 | 43.99 | 46.47 | 300 |
| zod + slim | 200 | 58.44 | 60.92 | 400 |
| zod + slim | 213 | 61.92 | 64.39 | 426 |
| zod + slim | 219 | 63.66 | 66.14 | 438 |
| zod + slim | 222 | 64.58 | 67.05 | 444 |
| zod + slim | 225 | 65.44 | 67.91 | 450 |
| zod + slim | 250 | 72.50 | 74.97 | 500 |
| mini | 50 | 9.48 | 11.79 | 100 |
| mini | 100 | 17.98 | 20.28 | 200 |
| mini | 150 | 26.41 | 28.70 | 300 |
| mini | 200 | 34.97 | 37.26 | 400 |
| mini | 250 | 43.22 | 45.53 | 500 |
| mini | 300 | 51.69 | 53.98 | 600 |
| mini | 350 | 60.22 | 62.53 | 700 |
| mini | 363 | 62.39 | 64.69 | 726 |
| mini | 369 | 63.44 | 65.75 | 738 |
| mini | 372 | 63.96 | 66.26 | 744 |
| mini | 375 | 64.49 | 66.79 | 750 |
| mini | 400 | 68.60 | 70.90 | 800 |
| mini + slim | 50 | 7.23 | 9.52 | 100 |
| mini + slim | 100 | 13.54 | 15.85 | 200 |
| mini + slim | 150 | 19.71 | 22.01 | 300 |
| mini + slim | 200 | 26.03 | 28.33 | 400 |
| mini + slim | 250 | 32.13 | 34.43 | 500 |
| mini + slim | 300 | 38.25 | 40.55 | 600 |
| mini + slim | 350 | 44.58 | 46.88 | 700 |
| mini + slim | 400 | 50.82 | 53.12 | 800 |
| mini + slim | 450 | 57.10 | 59.39 | 900 |
| mini + slim | 500 | 63.23 | 65.53 | 1000 |
| mini + slim | 504 | 63.69 | 65.99 | 1008 |
| mini + slim | 507 | 64.09 | 66.38 | 1014 |
| mini + slim | 513 | 64.88 | 67.19 | 1026 |
| mini + slim | 525 | 66.31 | 68.61 | 1050 |
| mini + slim | 550 | 69.46 | 71.76 | 1100 |