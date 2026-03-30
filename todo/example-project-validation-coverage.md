# Expand example project for codegen validation coverage

## Status: Open

## Context

The example project (`examples/task-manager`) is the primary validation target for the codegen regeneration guard in CI and `bin/release-beta`. It currently covers models, functions, codecs, filters, actions, and subdirectory modules — but lacks coverage for several Convex infrastructure patterns that caused real issues in hotpot's beta.51 upgrade.

## Tasks

### 1. Add `crons.ts`
- Create a simple cron that calls an existing internal mutation on a schedule
- Validates that `discoverModules()` correctly skips `crons.ts` (now in the ignore list)
- Should use `cronJobs()` from `convex/server` — the standard Convex cron pattern

### 2. Add `convex.config.ts`
- Add a basic component configuration file
- Even if the example doesn't use a real component, the file should exist with the standard `defineApp()` pattern
- Validates that `discoverModules()` correctly skips `convex.config.ts`

### 3. Add a published Convex component
- Install a real published component (e.g. `@convex-dev/action-retrier` or similar lightweight component)
- Wire it up in `convex.config.ts`
- Import and use it at module scope in a function file (the pattern that triggered the `_generated/api` stub fix)
- Validates that the Proxy stub allows module-scope component instantiation during discovery

### 4. Add a local/custom component
- Create a minimal local component in the example project (or use a workspace component)
- The component should be instantiated at module scope in a function file alongside a zodvex-wrapped export
- This is the exact pattern from hotpot's `visits/dropIn.ts` that motivated the discovery stub work
- Validates that codegen discovers functions from files that mix component instantiation with zodvex exports

### 5. Add `.withRules()` usage
- Add at least one function that uses `.withRules()` on a `ZodvexDatabaseReader` or `ZodvexDatabaseWriter`
- Validates that the lazy `import('./rules')` pattern in db.ts resolves correctly in the built bundle
- This was the tree-shaking bug in beta.51 that broke hotpot

### Priority
Medium — these are validation improvements, not features. But each one corresponds to a real bug we discovered and fixed during the beta.51/52/53 cycle. Adding them prevents regressions.

## Related
- `todo/codegen-static-analysis.md` — longer-term rethink of dynamic vs static discovery
- `.github/workflows/ci.yml` — codegen regeneration guard that runs against the example project
