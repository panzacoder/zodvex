# Enhancement: Type-safe field paths for generic model wrappers

**Status:** Deferred — not worth the lift yet. Revisit if more consumers hit this.

## Actual Problem (revised 2026-03-10)

The original plan described loop-based index accumulation, but hotpot's actual
pattern is simpler: `defineHotpotModel()` injects a known field and chains
`.index()` once. The `as any` is needed because `Fields` is generic — TypeScript
can't resolve `ModelFieldPaths<InsertSchema>` when `InsertSchema` depends on an
unresolved generic.

```typescript
// hotpot/convex/hotpot/model.ts line 230
return defineZodModel(name, fieldsWithRetention)
  .index(RETENTION_INDEX, [RETENTION_FIELD] as any)
//                                          ^^^^^^ can't prove field exists through generic
```

## Potential Solution: `fieldPath()` helper

Export an identity function from `zodvex/core` that centralizes the cast:

```typescript
// zodvex/core exports:
export function fieldPath<F extends string>(field: F): F & ModelFieldPaths<any> {
  return field as any // single centralized cast
}

// hotpot uses — no `as any` at call site:
return defineZodModel(name, fieldsWithRetention)
  .index(RETENTION_INDEX, [fieldPath(RETENTION_FIELD)])
```

**Trade-off:** This moves the `as any` from the consumer into zodvex, but
doesn't add real validation. It's a blessed escape hatch — cleaner than raw
`as any` but not fundamentally safer.

## Why deferred

One consumer, one call site, one `as any`. The current workaround is
well-commented and safe. Not worth adding API surface until more consumers
hit the same pattern.

## Original proposal (inline index config)

Superseded. The inline config overload wouldn't fix the generic field path
issue — it has the same TypeScript limitation. Loop-based accumulation isn't
used in practice.
