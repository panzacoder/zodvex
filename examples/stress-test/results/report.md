# Stress Test Report (real Convex push)

**Date:** 2026-04-27

## Baseline (each variant @ count=100)

| Variant | Pushed | Duration (s) | Error |
|---------|--------|--------------|-------|
| convex (baseline) | yes | 4.9 |  |

## Ceilings

Each row is the largest endpoint count that successfully pushes via
`npx convex deploy` against a real Convex dev deployment, found by
doubling-then-binary-search. A failed push (OOM, bundle size, or other)
sets the upper bound; the next probe halves the range.

| Variant | Max Endpoints |
|---------|--------------|
| convex (baseline) | 2032 |

## All probes

| Variant | Count | Pushed | Duration (s) | Error |
|---------|-------|--------|--------------|-------|
| convex (baseline) | 50 | yes | 12.0 |  |
| convex (baseline) | 80 | yes | 5.3 |  |
| convex (baseline) | 128 | yes | 6.4 |  |
| convex (baseline) | 204 | yes | 8.0 |  |
| convex (baseline) | 326 | yes | 10.8 |  |
| convex (baseline) | 521 | yes | 15.8 |  |
| convex (baseline) | 833 | yes | 24.5 |  |
| convex (baseline) | 1332 | yes | 40.7 |  |
| convex (baseline) | 1732 | yes | 48.1 |  |
| convex (baseline) | 1932 | yes | 37.5 |  |
| convex (baseline) | 2032 | yes | 30.7 |  |
| convex (baseline) | 2057 | no | 6.6 | other |
| convex (baseline) | 2082 | no | 7.3 | other |
| convex (baseline) | 2131 | no | 8.3 | other |