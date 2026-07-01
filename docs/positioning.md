# What zodvex is

**zodvex lets you use Zod v4 as your schema language for Convex.** You define your
tables, function arguments, and return types once as Zod schemas and use those same
definitions end to end — database to frontend. That is the identity: Zod is your source
of truth across a Convex app.

On top of that foundation, zodvex adds what plain validator-mapping doesn't:

- **Automatic runtime validation at every boundary** — arguments, return values, *and
  every document read at the database layer*. Validating at the db boundary (a real Zod
  `parse` on reads), not just at function edges, is a differentiator on its own.
- **Codec support at your application boundaries** — `zx.date()`, `zx.codec()`, and typed
  IDs encode/decode automatically at db reads/writes, function args, and return values.
  Handlers work with `Date` and branded IDs; the wire stays Convex-safe. Row-level rules
  (`.withRules()`) and audit hooks (`.audit()`) ride on the same codec-aware `ctx.db`.
- **Codegen that complements Convex's own** — a `_zodvex/` folder alongside `_generated/`
  gives client-safe schema imports and inferred validators for frontend queries, so your
  Convex functions stay the source of truth.

You configure all of it once with `initZodvex` and get correct builders back.

## What it is not

zodvex is **not** a validator-mapper and **not** a middleware / function-composition
framework. Validator mapping (Zod → Convex) is the foundation it stands on, delegated to
`convex-helpers` — it is not the product. And there is no `.use()` chain or plugin
`.extend()` surface: the "middleware" is the ambient codec-aware db, wired once via
`initZodvex`. If you want composable handler middleware, that is a different kind of
library (e.g. [fluent-convex](https://github.com/mikecann/fluent-convex)); the two live
at different layers and can compose (see
[`planning/fluent-convex-integration.md`](./planning/fluent-convex-integration.md)).

---

This file is the canonical positioning statement. `README.md` is self-contained and
carries the full pitch; `CLAUDE.md` and `docs/ARCHITECTURE.md` lead with the same framing
in brief. Keep the identity sentence above in sync across all four — if positioning
changes, change it here first.

## One-liner

> Use Zod v4 as your schema language for Convex — define your data once and use it end to
> end, with automatic validation and codecs at every boundary.
