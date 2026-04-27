# Stress Test Report (real Convex push)

**Date:** 2026-04-27

## Baseline (each variant @ count=100)

| Variant | Pushed | Duration (s) | Error |
|---------|--------|--------------|-------|
| convex (baseline) | yes | 11.5 |  |

## Ceilings

Each row is the largest endpoint count that successfully pushes via
`npx convex deploy` against a real Convex dev deployment, found by
doubling-then-binary-search. A failed push (OOM, bundle size, or other)
sets the upper bound; the next probe halves the range.

| Variant | Max Endpoints |
|---------|--------------|
| convex (baseline) | 1632 |

## All probes

| Variant | Count | Pushed | Duration (s) | Error |
|---------|-------|--------|--------------|-------|
| convex (baseline) | 50 | yes | 5.4 |  |
| convex (baseline) | 80 | yes | 5.4 |  |
| convex (baseline) | 128 | yes | 135.2 |  |
| convex (baseline) | 204 | yes | 8.4 |  |
| convex (baseline) | 326 | yes | 10.3 |  |
| convex (baseline) | 521 | yes | 14.3 |  |
| convex (baseline) | 833 | yes | 21.9 |  |
| convex (baseline) | 1332 | yes | 37.7 |  |
| convex (baseline) | 1532 | yes | 18.0 |  |
| convex (baseline) | 1632 | yes | 15.8 |  |
| convex (baseline) | 1657 | no | 9.1 | oom |
| convex (baseline) | 1682 | no | 10.1 | other |
| convex (baseline) | 1732 | no | 12.4 | oom |
| convex (baseline) | 2131 | no | 65.6 | other |