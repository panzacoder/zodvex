# Pre-commit codegen regeneration guard

## Problem

Generated files in `examples/task-manager/convex/_zodvex/` can become stale when codegen logic changes. The mantine false-positive fix (`2f7db05`) left stale mantine imports in the example app's generated files because nobody re-ran `zodvex generate` afterward.

## Proposed solutions

### Option A: Pre-tag hook in `bin/release`

Add a codegen regeneration + diff check step to `bin/release` before tagging:

```bash
# Regenerate example app codegen
(cd examples/task-manager && npx zodvex generate)

# Fail if generated files changed (developer should have committed these)
if ! git diff --quiet examples/task-manager/convex/_zodvex/; then
  echo "ERROR: Generated files are stale. Commit regenerated output before releasing."
  git diff --stat examples/task-manager/convex/_zodvex/
  exit 1
fi
```

**Pros:** Catches staleness at the most critical moment (release). Simple.
**Cons:** Only catches it at release time, not during normal development.

### Option B: CI check on PR

Add a GitHub Actions step that regenerates codegen and fails if the output differs from committed files:

```yaml
- name: Verify codegen is up to date
  run: |
    bun run build
    cd examples/task-manager && npx zodvex generate
    git diff --exit-code examples/task-manager/convex/_zodvex/
```

**Pros:** Catches staleness on every PR. Prevents stale files from merging.
**Cons:** Slightly longer CI. Requires the example app's convex schema to be importable in CI (needs convex peer dep available).

### Option C: Both

Run the check in both `bin/release` and CI. Belt and suspenders.

## Recommendation

Option C. The release script check is a fast local safeguard; the CI check is the durable guarantee.

## Related

- Commit `2f7db05` (mantine removal) is the motivating incident
- `bin/release` is the release script
- Example app: `examples/task-manager/`
