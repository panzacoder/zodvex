# What zodvex is

**zodvex lets you use Zod v4 as your schema language for Convex.** You define your
tables, function arguments, and return types once as Zod schemas and use those same
definitions end to end — database to frontend. That is the identity: Zod is your source
of truth across a Convex app.

The comparison axis that matters is **Convex's own validation system**: Convex's codegen
gives functions end-to-end type inference, and its built-in validators check structure at
runtime. zodvex uses the same Zod definitions for runtime parsing and encoding as
well as structural validator generation. Concretely:

- **Automatic validation for declared function schemas and modeled reads** — wrappers
  parse arguments and encode declared returns; the wrapped database parses modeled
  documents through their full Zod schema.
- **Codec support at your application boundaries** — `zx.date()` and `zx.codec()`
  encode/decode at modeled database and declared function boundaries. `zx.id()`
  supplies typed ID validation without a wire transform. Handlers work with runtime
  values while Convex stores wire values. Rules and audit hooks share the wrapped
  database; `unwrap()` provides native database access.
- **Codegen that complements Convex's own** — a `_zodvex/` folder alongside `_generated/`
  gives client-safe schema imports and inferred validators for frontend queries, so your
  Convex functions stay the source of truth.

Boundary behavior follows the operation and configuration: returns need a schema,
patches do not validate the resulting whole document, and client decode failures
warn and return raw data by default. See the [boundary contract](./decisions/2026-09-07-boundary-contract.md).

You configure all of it once with `initZodvex` and get correct builders back.

## What it is not

zodvex is **not** a validator-mapper and **not** a middleware / function-composition
framework. Validator mapping (Zod → Convex) is the foundation it stands on — not the
product. zodvex ships its **own** mapping layer (built directly on `zod/v4/core` and
`convex/values`): codec awareness and Convex's exact optional/nullable semantics require
deeper integration than a standalone converter. `convex-helpers` remains a peer dependency
for its custom-function convention and stream primitives — not for the mapping. And there
is no `.use()` chain or plugin
`.extend()` surface: the "middleware" is the ambient codec-aware db, wired once via
`initZodvex`. If you want composable handler middleware, that is a different kind of
library (e.g. [fluent-convex](https://github.com/mikecann/fluent-convex)); the two live
at different layers and can compose.

---

This file is the canonical positioning statement. `README.md` is self-contained and
carries the full pitch; `CLAUDE.md` and `docs/ARCHITECTURE.md` lead with the same framing
in brief. Keep the identity sentence above in sync across all four — if positioning
changes, change it here first.

## One-liner

> Use Zod v4 as your schema language for Convex — define your data once and use it end to
> end, with automatic function validation and a codec-aware database.
