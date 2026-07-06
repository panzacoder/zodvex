# Contributing to zodvex

Thanks for helping make zodvex better! This guide covers how the repo is laid out, how to
run things, and the conventions we follow.

## What zodvex is (read this first)

**zodvex lets you use Zod v4 as your schema language for Convex** — define your tables,
function arguments, and return types once as Zod schemas and use them end to end. The
standout differentiator is automatic validation and codecs at every boundary (function I/O
and the codec-aware `ctx.db`). It is **not** a validator-mapper (zodvex owns its mapping
layer in `internal/mapping/`; `convex-helpers` is a peer used for the custom-function
convention and streams, not the mapping) and **not** a middleware/function-composition
framework. See
[`docs/positioning.md`](docs/positioning.md) — contributions should reinforce that framing,
not drift toward "convex-helpers but nicer" or a builder-chain middleware model.

## Code of Conduct

By participating you are expected to uphold our Code of Conduct — be respectful and
constructive.

## How can I contribute?

### Reporting bugs

Check existing issues first. A good report includes: a clear title, exact repro steps, a
minimal code sample, observed vs expected behavior, error messages, and version info
(Node/Bun, `zod`, `convex`, `convex-helpers`, `zodvex`).

### Suggesting enhancements

Open an issue with a clear description, a concrete example, and why it helps zodvex users.
If your idea overlaps the roadmap ([`docs/roadmap.md`](docs/roadmap.md)), reference it.

### Pull requests

1. Branch from `main`.
2. Add tests for new code; update docs for API changes.
3. Run the checks below (`bun run lint`, `bun run type-check`, `bun run test`).
4. **PR titles must follow conventional-commit format** (`feat:`, `fix:`, `chore:`, `docs:`,
   …) — enforced by `.github/workflows/pr-title.yml`.
5. Open the PR.

## Monorepo layout

This is a **Bun workspaces** monorepo. All commands can be run from the repo root; they
delegate into `packages/zodvex/`.

```
zodvex/
├── packages/zodvex/          # the publishable library (source, tests, build config)
│   ├── src/
│   │   ├── public/           # canonical public surfaces (entrypoints: zodvex, zodvex/mini, …)
│   │   ├── internal/         # shared runtime + type machinery (model/schema/function/db/codec)
│   │   ├── legacy/           # deprecated runtime APIs kept for migration (tables.ts)
│   │   └── core/             # deprecated compatibility alias for `zodvex/core`
│   └── __tests__/            # vitest suite
├── examples/
│   ├── task-manager/         # full example (uses zodvex via workspace:*)
│   ├── task-manager-mini/    # same app on zod/mini (verifies mini compatibility)
│   ├── quickstart/           # minimal getting-started ("codecs without codegen")
│   └── stress-test/          # performance / OOM ceiling harness
└── package.json              # private workspace root (not published)
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the layered design (Zod v4 core
substrate → public flavor surfaces → shared model & function-contract pipelines).

## Development

```bash
bun install            # install workspace dependencies
bun run dev            # tsup watch build
bun run build          # build the library with tsup
bun run type-check     # tsc --noEmit
bun run test           # run vitest
```

> **Never use `bun test`.** That invokes Bun's built-in runner, which fails on vitest APIs.
> Always use `bun run test`.

Run a single test file:

```bash
bun run test -- packages/zodvex/__tests__/mapping.test.ts
```

### Linting & formatting (Biome)

```bash
bun run lint           # check (lint + format)
bun run lint:fix       # auto-fix
bun run format         # format only
```

### Full validation

`bun run validate` runs the full pre-release pipeline: lint → type-check → test →
verify:consumer-declarations → build → verify:examples → verify:examples:network → stress-test
ceiling search. The network step deploys the examples to real Convex dev instances, so it
requires a configured `CONVEX_DEPLOYMENT` per example and can't run in CI. For a local,
no-network subset use `bun run verify:examples`.

## Public API surface (current)

The mainline, supported API:

- **Setup:** `initZodvex(schema, primitives, opts?)` → `zq, zm, za, ziq, zim, zia` with a
  codec-aware `ctx.db`; `.withContext()`, `defineContext()`.
- **Models & schema:** `defineZodModel()`, `defineZodSchema()`.
- **`zx` namespace** (the zodvex analogue of Zod's `z`): codec/validator constructors
  (`zx.date()`, `zx.codec()`, `zx.id()`) **and** schema-derivation helpers (`zx.doc()`,
  `zx.update()`, `zx.docArray()`, `zx.paginationResult()`, `zx.paginationOpts()`).
- **DB security/audit:** `.withRules()`, `.audit()` on the wrapped `ctx.db`.
- **Streams:** `zodvexStream`, `zodvexMergedStream`.
- **Codegen (optional):** `zodvex generate` / `zodvex dev`, typed hooks, boundary helpers.
- **Low-level (advanced):** `zodToConvex`, `zodToConvexFields`, `decodeDoc`, `encodeDoc`,
  `pickShape`, `safePick`.

### Deprecated — do not extend

These remain exported for migration only and should **get thinner, not smarter** (no new
capability work): `zodTable` / `zodDoc`, `zQueryBuilder` / `zMutationBuilder` /
`zActionBuilder` (+ `zCustom*Builder`), `zid()`, `convexCodec()`, `mapDateFieldToNumber()`,
and the `zodvex/core` / `zodvex/legacy` entrypoints. Native `z.date()` intentionally throws —
use `zx.date()`. New features belong on the `initZodvex` / `defineZodModel` / `zx` path.

## Testing

We use **vitest** (`packages/zodvex/__tests__/`), including type-level assertions. Guidelines:

- Cover happy paths and edge cases; keep tests isolated (no external services).
- Test **both encode and decode** for codecs.
- Follow existing patterns; add type tests for non-trivial type transformations.
- The example apps double as integration coverage — `verify:examples` typechecks and runs
  them, and regenerates codegen in both task-manager apps.

## Coding style

- TypeScript, strict mode. No semicolons, single quotes, 2-space indent (enforced by Biome).
- **zod/mini compatibility:** all shared type constraints and `instanceof` checks use
  `$ZodType` and subclasses from `zod/v4/core` (never `z.Zod*` in shared code — the
  `lint:core-types` gate enforces this; annotate intentional exceptions with `// zod-ok`).
  Schema *construction* still uses `z.*()` from full zod. See
  [Zod's library-author guidance](https://zod.dev/library-authors).
- Preserve Convex's optional/nullable semantics: `.optional()` → `v.optional(T)`,
  `.nullable()` → `v.union(T, v.null())`.
- No `any` in public APIs; keep exports tree-shakeable; document non-obvious logic.

## Commit & PR conventions

- Conventional-commit format for **commits and PR titles** (`feat:`, `fix:`, `chore:`,
  `docs:`, `test:`, `refactor:`). Imperative mood, present tense.
- Reference issues in the body.

## Releases (maintainers)

Beta releases: `bin/release-beta` (auto-increments the prerelease number, builds, tests,
tags, pushes). A tag push triggers `.github/workflows/release.yml` → `npm publish --tag beta`.
Stable releases are currently cut manually. Run `bun run validate` locally before trialing a
release downstream — CI can't perform the Convex deploy step.

## Questions?

Open an issue or a GitHub Discussion. Contributions are licensed under MIT.

---

Thank you for contributing! 🎉
