# Revisit static vs dynamic analysis for codegen discovery

## Status: RFC — Ready for Review

## Context

`discoverModules()` uses dynamic `import()` to load every file in the convex directory and read attached zodvex metadata. This requires executing all module-scope code, which fails when files import Convex runtime-only APIs (components, etc.).

## Current workaround (beta.51)

- Stub `_generated/api.ts` with a deep Proxy during discovery so `components.*` access and component constructors succeed silently
- `_generated/server.ts` is NOT stubbed — its exports (`query`, `mutation`, etc.) are re-exports of `convex/server` generics which work natively in Node.js/Bun
- Test files (`*.test.ts`, `*.spec.ts`) are excluded from discovery to avoid vitest-specific APIs like `import.meta.glob`

## Why the Proxy approach is fragile

The deep Proxy absorbs property access, function calls, and constructor calls. But it breaks under:
- **Type coercion** — `Number(proxy)` or `proxy + 1` throws (no `Symbol.toPrimitive`)
- **Iteration** — `[...proxy]` throws (no `Symbol.iterator`)
- **JSON serialization** — `JSON.stringify(proxy)` throws

For Convex component constructors that just store the reference (like `this.component = component`), this works. But any constructor that coerces or iterates over the component argument would fail.

## Why we can't avoid the problem entirely

Hotpot's `convex/visits/dropIn.ts` both instantiates a component at module scope AND exports a zodvex-wrapped mutation from the same file. Discovery can't skip the file (loses the function metadata) and can't import it without the stub (component constructor throws).

## Static analysis alternative

Instead of `await import(file)` to get live Zod schema instances, parse the AST to extract:
1. Which exports call zodvex wrappers (`zQuery`, `zMutation`, `hotpotPublicMutation`, etc.)
2. The Zod schema arguments passed to those wrappers
3. Exported `zodTable` / `defineZodModel` calls for model discovery

### Challenges
- zodvex metadata is attached at runtime via `attachMeta()` — static analysis would need to trace the call chain from the wrapper to the schema
- Codecs (`zx.codec()`) create runtime Zod instances that are hard to represent statically
- Custom function builders (via `zCustomQuery` etc.) add indirection between the user's code and the metadata attachment
- Would need to handle re-exports, barrel files, and aliased imports

### Possible hybrid approach
- Use static analysis to identify which files have zodvex exports (cheap, no execution)
- Only dynamically import those files, with targeted stubs for known problem modules
- Fall back to full dynamic import for files that static analysis can't resolve

## Decision needed

1. **Pure static** — Maximum safety, but can't resolve runtime-constructed schemas (codecs, dynamic wrappers). Would need a "schema registry" escape hatch.
2. **Hybrid (recommended)** — Static pass to filter files, dynamic import only for zodvex-exporting files with enhanced stubs. Best balance of safety and compatibility.
3. **Enhanced dynamic** — Keep current approach, expand Proxy to handle more edge cases (`Symbol.toPrimitive`, `Symbol.iterator`, `toJSON`). Least work, but fragility compounds.

## Related
- `docs/plans/2026-02-25-codegen-runtime-vs-ast.md` — earlier analysis of runtime vs AST approaches
- `src/codegen/discover.ts` — current dynamic discovery implementation
- `src/codegen/discovery-hooks.ts` — Proxy stub mechanism
