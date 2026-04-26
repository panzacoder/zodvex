# Stress Test Report

**Date:** 2026-04-26
**Budget:** 64 MB

## OOM Ceilings

`per-endpoint` is the slope between the smallest and largest passing
measurements — the incremental cost of adding one model. Heap at the
ceiling itself is always ≈ budget by construction, so it's omitted here.

| Variant | Max Endpoints | Per-endpoint (KB) |
|---------|--------------|-------------------|
| zod + codegen | 125 | 503.0 |

## All Measurements

| Variant | Count | Heap Delta (MB) | Peak (MB) | Modules |
|---------|-------|-----------------|-----------|---------|
| zod + codegen | 50 | 26.00 | 28.47 | 100 |
| zod + codegen | 100 | 50.64 | 53.12 | 200 |
| zod + codegen | 125 | 62.86 | 65.34 | 250 |
| zod + codegen | 129 | 64.82 | 67.29 | 258 |
| zod + codegen | 132 | 66.27 | 68.75 | 264 |
| zod + codegen | 138 | 69.36 | 71.84 | 276 |
| zod + codegen | 150 | 75.12 | 77.60 | 300 |