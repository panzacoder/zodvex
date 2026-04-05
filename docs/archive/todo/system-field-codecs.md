# Auto-decode `_creationTime` as `Date` via `zx.date()`

## Problem

`addSystemFields` adds `_creationTime: z.number()` — a plain number with no codec. Users must write `_creationTime` comparisons with raw timestamps:

```typescript
q.gte(q.field("_creationTime"), date.getTime())  // ← manual encoding
```

A codec-first library should decode `_creationTime` as `Date` automatically, consistent with how user-defined `zx.date()` fields work.

## Proposed change

In `src/schemaHelpers.ts`, change `_creationTime` from `z.number()` to `zx.date()`:

```typescript
// Type (line ~25)
_creationTime: z.ZodNumber  →  _creationTime: ZxDate

// Runtime (lines ~160, ~173)
_creationTime: z.number()  →  _creationTime: zx.date()
```

## Impact

- All decoded documents would have `_creationTime: Date` instead of `_creationTime: number`
- Filter/index comparisons would accept `Date` for `_creationTime`
- **Breaking change** for consumers comparing `_creationTime` as a number
- Affects `addSystemFields`, `defineZodModel`, `zodTable`, all doc schemas

## To explore

- [ ] Check if hotpot or the example project compares `_creationTime` as a number anywhere
- [ ] Test that `zx.date()` round-trips correctly through the codec layer for system fields
- [ ] Consider whether `_id` should also get a codec treatment (branded `Id<TableName>` instead of plain string)
- [ ] Evaluate migration path — could this be opt-in via a `defineZodSchema` option?
