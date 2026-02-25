# Enhancement: defineZodModel with inline index config

## Problem

When downstream consumers need to chain indexes onto a ZodModel in a loop (e.g., hotpot's `defineHotpotModel`), each `.index()` call returns a new `ZodModel` with different generic type parameters. TypeScript can't accumulate type-level changes across loop iterations, forcing `let zodModel: any`.

```typescript
// Current pattern — requires `any` to accumulate
let zodModel: any = defineZodModel(name, fields)
for (const [indexName, indexFields] of Object.entries(indexes)) {
  zodModel = zodModel.index(indexName, indexFields)
}
```

## Proposal

Add an overload to `defineZodModel` that accepts index configuration inline:

```typescript
// New overload — no loop, no any
const model = defineZodModel(name, fields, {
  indexes: {
    byClinic: ['clinicId'],
    byEmail: ['email.value'],
  },
  searchIndexes: {
    searchName: { searchField: 'name', filterFields: ['clinicId'] },
  },
  vectorIndexes: {
    embeddings: { vectorField: 'embedding', dimensions: 1536 },
  },
})
```

The return type would compute all index generics at once from the config object literal, preserving full type safety without iteration.

## Scope

- Add overload 3 to `defineZodModel` in `model.ts`
- Existing overloads (raw shape, pre-built schema) remain unchanged
- Chainable `.index()` / `.searchIndex()` / `.vectorIndex()` remain for incremental use
- The inline config is sugar that computes the same result as chaining

## Priority

Low — the `any` workaround is safe and well-understood. This is a DX enhancement for downstream framework authors (hotpot).
