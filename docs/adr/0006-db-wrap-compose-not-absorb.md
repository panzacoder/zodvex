# Decision: db-wrap composability — compose now (0.7.x), absorb later (0.8 candidate)

**Date:** 2026-07-07
**Status:** Accepted — landing in 0.7.8
**Context:** zodvex#92 (split out of zodvex#85); hotpot blocked on `DirectAggregate`
**Relates-to:** `docs/positioning.md` (the codec-aware db is the differentiator; its
"middleware" is wired once via `initZodvex`)

---

## Problem

`convex-helpers/server/triggers` composes by replacing the mutation builder and
wrapping `ctx.db`:

```ts
export const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB))
```

That is the same slot zodvex's `zm` / `initZodvex({ wrapDb: true })` occupies — both
are "the custom mutation builder that wraps `ctx.db`." The two builders compete for
the proxy, so a trigger cannot fire inside a zodvex-wrapped mutation. Downstream
(hotpot) fell back to `DirectAggregate` — manual `.insert`/`.delete` at every write
site — citing exactly this collision.

The gap blocks two capabilities, not one:

- **Triggered aggregates** — `@convex-dev/aggregate`'s table-trigger mode
  (auto-maintained counts on writes).
- **Model-bound cascades** — "when a visit's `roomId` changes, move the related
  rows," bound to the data change instead of a privileged call every caller must
  remember.

## Two resolution shapes

1. **Compose** — zodvex's codec/RLS wrapper delegates to an *underlying* db the user
   supplies, so `triggers.wrapDB` sits **under** it:
   `codec (zodvex) → triggers (convex-helpers) → real db`.
2. **Absorb** — zodvex grows native trigger registration on its own wrapper (and,
   eventually, cascades declared on models next to their access rules), so one
   wrapper does codec + RLS + triggers.

## Decision

**Ship compose now, as an additive 0.7.x feature.** Absorb stays the possible 0.8
end-state; compose is designed so it does not preclude it (see below).

### API

- `initZodvex(schema, server, { underlyingDb })` — new optional setting on the
  wrapDb-enabled overload:

  ```ts
  const triggers = new Triggers<DataModel>()
  export const { zq, zm, zim } = initZodvex(schema, server, {
    underlyingDb: {
      mutation: (ctx) => triggers.wrapDB(ctx).db,
      // query?: (ctx) => ...   — same hook for readers (e.g. RLS layers)
    },
  })
  ```

  The resolver receives the **raw** Convex ctx (untouched by zodvex) and returns the
  db the codec wrapper should delegate to. It runs once per function invocation, at
  the same point the codec wrapper is constructed today.

- `createZodvexCustomization(tableMap, { underlyingDb })` — the manual-composition
  escape hatch gets the same option.

- `db.unwrap()` — minimal escape hatch from #85: returns the database the codec
  wrapper delegates to (the composed underlying stack when `underlyingDb` is
  configured, the bare Convex db otherwise). Available on readers and writers,
  including `.withRules()`/`.audit()`-wrapped instances — it bypasses codec, rules,
  and audit, by design. Writes through it are wire-format and unguarded; reads are
  undecoded.

### Why codec sits on top

Triggers from convex-helpers are written against the **native db shape**: their
`Change` docs are wire-format documents and their writes go through a native
`GenericDatabaseWriter`. With codec on top, the trigger layer sees exactly that —
zodvex encodes (`Date` → number, codecs → wire) *before* the write reaches the
trigger writer, and trigger-initiated writes never pass back through the codec
layer. Ordering is pinned by tests (a `zx.date()` field observed as a number inside
a trigger).

The inverse stacking (triggers on top of codec) would hand convex-helpers a
non-native writer and decoded documents it has no contract for. Rejected.

### Interaction with `.withRules()` / `.audit()`

Rules/audit wrappers reconstruct from `_internals.db` — the underlying db the codec
wrapper delegates to. A trigger-wrapped underlying db therefore survives
`.withRules()`/`.audit()` chaining with no extra plumbing: rules run in decoded
space on top, writes encode once, triggers fire underneath.

## Why not absorb now

Absorb is a real design surface, not a plumbing change: trigger lifecycle alongside
rules/audit ordering, decoded-space vs wire-space trigger payloads, recursion/queue
semantics (convex-helpers serializes recursive triggers), and model-level
declaration syntax. Shipping compose first unblocks downstream immediately, keeps
0.7.x additive, and lets real usage inform the absorbed design.

## How compose keeps absorb open

- **Compose is the primitive absorb would build on.** Native registration
  (`initZodvex({ triggers })` or model-declared cascades) can be implemented
  internally as a zodvex-owned trigger layer inserted at the same delegation point
  `underlyingDb` targets today. Nothing about the option's position in the stack is
  specific to convex-helpers.
- **No public surface is burned.** `underlyingDb` stays meaningful post-absorb
  (users may still want to slot arbitrary native-shape layers under the codec);
  absorbed triggers would run in *decoded* space as a distinct, complementary
  convention.
- **`unwrap()` is shape-agnostic** — it returns "whatever the codec delegates to,"
  which remains well-defined however that stack is built.

## Non-goals (this change)

- No change to `.withContext()` ordering (user customizations still see the
  codec-wrapped db).
- No zodvex-native trigger registration, no model-bound cascade syntax (0.8
  candidate, tracked in #92).
- Existing behavior is byte-for-byte unchanged when `underlyingDb` is not supplied.
