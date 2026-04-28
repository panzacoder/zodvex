# Stress Test Report (real Convex push)

**Date:** 2026-04-28

## Baseline (each variant @ count=100)

Bundle bytes are reported by `convex deploy --verbose` and reflect
the size of the compiled artifact uploaded to the deployment, which
is the closest concrete proxy for what the push-time isolate has
to load.

| Variant | Pushed | Duration (s) | Unzipped | Zipped | Error |
|---------|--------|--------------|----------|--------|-------|
| zod + compile | yes | 13.1 | 1.65 MB | 275.0 KB |  |

## Ceilings

Each ceiling is found by binary-searching the local heap proxy
(48 MB threshold, allowing for ~16 MB of Convex runtime overhead in
the 64 MB push-time isolate), then verified by a single real
`convex deploy` push at the candidate count. Status:

- `pushed` — real-deploy confirmed the proxy estimate
- `oom` — proxy over-estimates; real push hit the 64 MB isolate cap
- `env-failure` — real push failed for non-memory reasons
  (TooManyReads, function-array, timeout); proxy says memory is fine

| Variant | Ceiling | Status |
|---------|---------|--------|
| zod + compile | 2000 | env-failure |

## Probe detail

| Variant | Count | Pushed | Duration (s) | Unzipped | Zipped | Error |
|---------|-------|--------|--------------|----------|--------|-------|
| zod + compile | 2000 | no | 600.0 | 10.93 MB | 795.6 KB | timeout |