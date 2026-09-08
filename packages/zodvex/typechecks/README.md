# Compiler-checked regressions

`bun run type-check` checks `*.test-d.ts` here with TypeScript. These files are
not runtime tests: positive calls must compile and each `@ts-expect-error` must
produce a diagnostic. Do not put new type-only tests in `__tests__`, where Vitest
transpilation does not check TypeScript assertions.

`database-overloads.test-d.ts` covers decoded writes, inferred reads, and rejected
calls for ID-first and table-first database APIs. `model-index-paths.test-d.ts`
contains the index-path assertions formerly expressed as always-passing runtime
tests. `mapping.test-d.ts` replaces the dormant mapping tests with assertions
against consumer value types and optionality using the supported Convex types.

Known decoded document unions require a complete variant for `patch`, matching
the runtime union encoder. Ordinary object documents and native fallback tables
retain partial patch types. These database generics carry output types, not
schema classes: erased types or unions that collapse to one output type cannot
be distinguished here. Runtime encoding remains authoritative.

Legacy coverage still needs a separate migration: `optional-enum-fields` and
`zodtable-enum-fields` remain explicitly excluded in `tsconfig.typecheck.json`.
The old `__tests__/{tables,tables-enum,introspection}.test-d.ts` files also remain
outside this suite. They use the deprecated table API and stale Convex validator
signatures (and some refer to missing generated modules); they are not evidence
of passing type checks. Their migration should accompany work on that legacy API.
