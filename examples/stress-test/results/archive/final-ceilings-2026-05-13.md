# Final ceilings — with `_zodvex/convex.config.ts` marker + schema-only-thin

Two-day investigation landed on a one-file fix. The combination of:

1. **Schema-only-thin** (`defineZodvexSchema(tables)` + codegen tables/tableMap)
2. **`_zodvex/convex.config.ts` marker** (this PR)

… moves zodvex's memory ceiling **from N≈155 to N≈2000** — matching the
pure-convex baseline. No userland renames, no consumer migration, no
zod/mini required.

## Old vs new ceilings (real Convex pushes)

| Flavor + config | Old ceiling | New ceiling | Failure mode at higher N |
|---|---:|---:|---|
| `zodvex` (default) | **155** | **2000+** | TooManyReads (non-memory) |
| `zodvex` + slim models | 350 | 2000+ | TooManyReads |
| `zodvex-mini` | 425 | 2000+ | TooManyReads at ~1500 |
| `zodvex-mini` + slim | 700 | 2000+ | TooManyReads |
| `convex-helpers` (zod4) | 400-500 | — | unchanged (separate library) |
| `convex-helpers-zod3` | 2000+ | — | unchanged |
| `convex` (plain) | 2000+ | — | unchanged |

**Net result**: zodvex consumers now have effectively the same memory
headroom as plain Convex apps. Slim models and zod/mini stay useful
in other dimensions (per-endpoint heap, smaller bundles) but are no
longer required to clear the memory ceiling.

## What the marker file does

Drops one tiny file at `convex/_zodvex/convex.config.ts`:

```ts
import { defineApp } from 'convex/server'
export default defineApp()
```

Convex's bundler walker (`entryPoints()` in
`convex/dist/esm/bundler/index.js`) skips any subdirectory of `convex/`
that contains a `convex.config.ts`. It treats those as nested component
definitions. We don't actually register `_zodvex/` as a component — we
just want the walker to skip the directory so the codegen artifacts
inside (api.js with all the inline zod schemas, client.js, tables.ts)
aren't analyzed as individual function-module entrypoints in their own
64 MB isolates.

## What was happening before the marker

Each file in `convex/` is bundled and analyzed as a separate entrypoint
under Convex's per-entrypoint analysis. zodvex's codegen emits five
single-dot files in `convex/_zodvex/`:

- `api.js` — registry of inline `z.object({...})` schemas per function
- `client.js` — `createZodvexHooks(zodvexRegistry)` (statically imports api.js)
- `schema.js` — model re-exports
- `server.js` — context types
- `tables.ts` — pure Convex table definitions (lazy-tables only)

At N=200, `api.js` is ~158 KB and contains 1000 inline zod schemas.
Loading it as a standalone entrypoint exceeded the 64 MB isolate cap.
Adding the marker makes Convex skip the directory entirely. The
codegen files are still bundled into anything that imports them (via
esbuild's normal resolution), but they're no longer each analyzed in
their own isolate.

## Why we considered (and rejected) two other approaches

**Multi-dot rename** (`api.js` → `api.data.js` etc.): Convex's walker
also skips files with multiple dots in the basename. We tested this
and it worked, but it relies on an undocumented walker convention and
required renaming files our users import from. The marker file uses
Convex's documented component-directory mechanism instead.

**Sibling `zodvex/` directory outside `convex/`**: structurally clean
but requires migrating user-authored model files and frontend imports.
Worth revisiting in a future major version if the marker stops working
or if `convex/_zodvex/` indirection becomes a documented anti-pattern.

## Validation

| | Result |
|---|---|
| `bun run build` | clean |
| `bun run test` | 1954/1954 pass |
| `examples/task-manager` typecheck | clean |
| `examples/task-manager` deploy | 9.35s (passes) |
| zodvex N=2000 lazy-tables + marker | passes (52s deploy) |
| zodvex-mini N=2000 lazy-tables + marker | TooManyReads (Convex non-memory limit) |

## Three things to take to Ian

1. **The skip rule is intentional, right?** Convex's bundler skips
   subdirectories of `convex/` that contain `convex.config.ts` and
   treats them as nested components. We're leveraging that to keep
   codegen output out of entrypoint analysis. Is this stable?

2. **The per-entrypoint analyzer works well, but the entrypoint set is
   the surprise.** Many tooling-generated files inside `convex/` are
   single-dot `.js` files that walker picks up. Once the analyzer is
   per-entrypoint, anything heavy that gets discovered as one becomes
   a hard 64 MB-per-file ceiling. Worth documenting which file
   conventions are skipped.

3. **Would Convex consider a documented "tooling output" convention?**
   Either a name pattern (`_<tool>/`) or a marker file specifically
   for "tooling output, don't analyze as a component, just skip" —
   different from the component-definition meaning of
   `convex.config.ts`. Right now we're slightly abusing that file's
   purpose; clean for us, but it's a borrowed semantic.

## Files in this commit

- `packages/zodvex/src/public/cli/commands.ts` — emit
  `_zodvex/convex.config.ts` from `generate()` and stub it in
  `writeStubApi()` for bootstrap.
- `packages/zodvex/src/public/cli/init.ts` — write the marker as
  part of `generateStubs()`.
- `examples/stress-test/results/final-ceilings-2026-05-13.md` (this file)
- `examples/stress-test/results/multi-dot-rename-2026-05-13.md` (the
  parallel investigation that found the entrypoint walker's behavior
  but is superseded by the marker approach)
