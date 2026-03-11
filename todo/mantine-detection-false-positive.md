# Mantine form integration leaking into codegen for non-mantine consumers

## Problem

`zodvex generate` produces mantine integration code (`mantineResolver` export, `import from 'zodvex/form/mantine'`) in hotpot's generated client files, even though hotpot doesn't use mantine. This confused a code reviewer on hotpot MR !128.

## Recommended Fix: Strip mantine from codegen entirely

The mantine/form integration is untested in any real consumer and not ready for production. The simplest fix is to remove it from the codegen path for now:

- Remove `detectFormIntegrations()` from `src/codegen/detect.ts` (or make it always return `false`)
- Remove the `form?.mantine` branches from `generateClientFile()` in `src/codegen/generate.ts`
- Remove `@mantine/form` from `peerDependencies` and `peerDependenciesMeta` in `package.json`
- Remove `mantine-form-zod-resolver` from the monorepo root's dev dependencies
- Keep `src/form/mantine/index.ts` and the `zodvex/form/mantine` export in place — the runtime code can stay, it just shouldn't be auto-generated into consumer client files
- Mark the form integration as pre-alpha/WIP in docs if needed

The mantine codegen can be re-added when a real consumer needs it, with proper opt-in (e.g. a `zodvex.config.ts` flag rather than auto-detection).

## Alternative: Fix the detection logic

If stripping isn't preferred, the auto-detection has a bug that needs fixing:

### Root Cause

`detectFormIntegrations()` uses `require.resolve('mantine-form-zod-resolver', { paths: [projectRoot] })`. This false-positives because:

1. zodvex declares `@mantine/form` as an **optional peer dependency**
2. **Bun auto-installs optional peer deps by default** (unlike npm/yarn)
3. So `@mantine/form` gets installed in the consumer's `node_modules` even though nobody asked for it
4. `mantine-form-zod-resolver` peers on `@mantine/form` — gets pulled in too
5. `require.resolve` succeeds → mantine code is generated

### Alternative Fix

Replace `require.resolve` with a check of the consumer's `package.json` for an explicit dependency:

```typescript
function isExplicitDependency(pkg: string, projectRoot: string): boolean {
  try {
    const pkgJsonPath = path.join(projectRoot, 'package.json')
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
    return !!(
      pkgJson.dependencies?.[pkg] ||
      pkgJson.devDependencies?.[pkg] ||
      pkgJson.peerDependencies?.[pkg]
    )
  } catch {
    return false
  }
}
```

## Evidence from hotpot

```
# hotpot's package.json has NO mantine references
grep "@mantine" package.json  # (empty)

# But it's installed anyway via bun's optional peer auto-install
ls node_modules/@mantine/form  # exists
ls node_modules/mantine-form-zod-resolver  # exists
```

## Severity

Low — doesn't break anything, but adds unwanted code to generated files.
