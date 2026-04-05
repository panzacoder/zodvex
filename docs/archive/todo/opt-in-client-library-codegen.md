# Opt-in client library codegen (mantine, TanStack Form, etc.)

## Context

The mantine form integration was removed from codegen (`2f7db05`) because auto-detection via `require.resolve` false-positived when Bun auto-installed optional peer deps. The runtime code (`zodvex/form/mantine`) still exists and works — it's just no longer auto-generated into consumer `_zodvex/client.*` files.

## Goal

Re-enable codegen for client library integrations with a proper opt-in mechanism that:
1. Never poisons generated files with imports for libraries the consumer doesn't use
2. Is extensible to future integrations (TanStack Form, React Hook Form, etc.)
3. Gives consumers explicit control

## Proposed design: `zodvex.config.ts`

```typescript
// zodvex.config.ts (in consumer project root)
import { defineConfig } from 'zodvex'

export default defineConfig({
  // Only generate integrations the consumer explicitly enables
  client: {
    integrations: ['mantine'],  // or ['tanstack-form', 'react-hook-form']
  },
})
```

### How it works

1. `zodvex generate` checks for `zodvex.config.ts` (or `.js`, `.json`) in the project root
2. If no config exists, no integrations are generated (current behavior)
3. If config lists integrations, codegen generates the corresponding exports in `client.*`
4. Each integration is a codegen plugin: `src/codegen/integrations/mantine.ts`, etc.

### Detection fallback (optional, lower priority)

If we want to offer auto-detection as a convenience on top of opt-in:

```typescript
export default defineConfig({
  client: {
    // Explicit list takes precedence
    integrations: ['mantine'],
    // Or: auto-detect from package.json dependencies (not node_modules)
    autoDetect: true,  // reads consumer's package.json, not require.resolve
  },
})
```

The `package.json` check approach (from the original mantine todo) is the right detection mechanism:

```typescript
function isExplicitDependency(pkg: string, projectRoot: string): boolean {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'))
  return !!(
    pkgJson.dependencies?.[pkg] ||
    pkgJson.devDependencies?.[pkg]
  )
}
```

This avoids the `require.resolve` false-positive that caused the original bug.

## Integration plugin structure

Each integration would provide:
- `generateImports()` — import statements for the generated client file
- `generateExports()` — export statements for the generated client file
- `peerDependency` — the package name to check if using auto-detect

```typescript
// src/codegen/integrations/mantine.ts
export const mantineIntegration: ClientIntegration = {
  name: 'mantine',
  peerDependency: '@mantine/form',
  generateImports: () => `import { mantineResolver as _mantineResolver } from 'zodvex/form/mantine'`,
  generateExports: () => `export const mantineResolver = (ref) => _mantineResolver(zodvexRegistry, ref)`,
}
```

## Scope

- [ ] Define `zodvex.config.ts` schema and loader
- [ ] Refactor `generateClientFile()` to accept integration plugins
- [ ] Create mantine integration plugin (move existing logic)
- [ ] Add config file detection to CLI
- [ ] Tests for opt-in and auto-detect modes
- [ ] Document in README

## Priority

Medium — mantine codegen worked before and has a known consumer (motiion). But no consumer is blocked right now since the runtime import path (`zodvex/form/mantine`) still works for manual use.

## Related

- `todo/mantine-detection-false-positive.md` — the bug that motivated removal (now resolved)
- `src/form/mantine/index.ts` — runtime code (still exists, still exported)
- `src/codegen/generate.ts` — where client file generation happens
- `src/codegen/detect.ts` — where `canResolve()` still lives as a utility
