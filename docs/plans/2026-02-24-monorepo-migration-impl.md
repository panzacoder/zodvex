# Monorepo Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move zodvex library into `packages/zodvex/` and configure bun workspaces to eliminate the infinite `node_modules` symlink loop.

**Architecture:** Root becomes a bare workspace root (`"private": true`). The library moves to `packages/zodvex/` as a workspace member. Examples reference it via `"workspace:*"`. All done with `git mv` to preserve blame.

**Tech Stack:** Bun workspaces, tsup, TypeScript

---

### Task 1: Create packages/zodvex/ directory and move library files

**Files:**
- Create: `packages/zodvex/` directory
- Move (git mv): `src/`, `__tests__/`, `tsconfig.json`, `tsup.config.ts`, `biome.json`, `index.ts`, `.npmignore`, `scratch/`, `test-utils/`, `typechecks/`, `convex/`

**Step 1: Create the packages directory**

```bash
mkdir -p packages/zodvex
```

**Step 2: Move library files with git mv**

```bash
git mv src packages/zodvex/
git mv __tests__ packages/zodvex/
git mv tsconfig.json packages/zodvex/
git mv tsup.config.ts packages/zodvex/
git mv biome.json packages/zodvex/
git mv index.ts packages/zodvex/
git mv .npmignore packages/zodvex/
git mv scratch packages/zodvex/
git mv test-utils packages/zodvex/
git mv typechecks packages/zodvex/
git mv convex packages/zodvex/
```

**Step 3: Verify the move**

```bash
ls packages/zodvex/
```

Expected: `__tests__/`, `biome.json`, `convex/`, `index.ts`, `.npmignore`, `scratch/`, `src/`, `test-utils/`, `tsconfig.json`, `tsup.config.ts`, `typechecks/`

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: move library files to packages/zodvex/"
```

---

### Task 2: Create packages/zodvex/package.json

**Files:**
- Create: `packages/zodvex/package.json`

**Step 1: Create the package.json**

Copy the current root `package.json` to `packages/zodvex/package.json`. This is the publishable package — it keeps the name `"zodvex"`, all exports, bin, peer deps, scripts, etc.

The content should be identical to the current root `package.json` (as it exists right now, without any workspaces field). Read the current root `package.json` and write it to `packages/zodvex/package.json`.

**Step 2: Verify**

```bash
cat packages/zodvex/package.json | grep '"name"'
```

Expected: `"name": "zodvex"`

**Step 3: Commit**

```bash
git add packages/zodvex/package.json
git commit -m "refactor: add packages/zodvex/package.json"
```

---

### Task 3: Rewrite root package.json as workspace root

**Files:**
- Modify: `package.json` (root)

**Step 1: Replace root package.json with workspace root**

Replace the entire content of the root `package.json` with:

```json
{
  "name": "zodvex-root",
  "private": true,
  "workspaces": ["packages/*", "examples/*"],
  "scripts": {
    "build": "bun run --cwd packages/zodvex build",
    "dev": "bun run --cwd packages/zodvex dev",
    "type-check": "bun run --cwd packages/zodvex type-check",
    "test": "bun run --cwd packages/zodvex test",
    "lint": "bun run --cwd packages/zodvex lint",
    "lint:fix": "bun run --cwd packages/zodvex lint:fix",
    "format": "bun run --cwd packages/zodvex format"
  }
}
```

**Step 2: Update example dependency**

In `examples/task-manager/package.json`, change:

```json
"zodvex": "file:../../"
```

to:

```json
"zodvex": "workspace:*"
```

Also add `zod` as a dependency since it's a peer dep of zodvex and the workspace hoists differently:

Check if `zod` is already listed. If not in dependencies or devDependencies, add it. The example imports `zod` directly in its model files.

**Step 3: Commit**

```bash
git add package.json examples/task-manager/package.json
git commit -m "refactor: root becomes workspace root, example uses workspace:*"
```

---

### Task 4: Delete old node_modules and reinstall

**Files:**
- Delete: `examples/task-manager/node_modules/` (the broken infinite loop)
- Delete: `node_modules/` (root — will be recreated)
- Delete: `bun.lock` (will be regenerated for workspace layout)

**Step 1: Clean up**

```bash
rm -rf examples/task-manager/node_modules
rm -rf node_modules
rm -f bun.lock
```

**Step 2: Install from root**

```bash
bun install
```

Expected: resolves all dependencies, creates workspace symlinks. No errors.

**Step 3: Verify no infinite loop**

```bash
ls examples/task-manager/node_modules/zodvex/examples 2>&1
```

Expected: error or empty — NOT another `task-manager/` directory.

Alternatively, verify the symlink:

```bash
readlink node_modules/zodvex 2>&1 || ls -la node_modules/zodvex 2>&1 | head -3
```

**Step 4: Commit the new lockfile**

```bash
git add bun.lock
git commit -m "chore: regenerate bun.lock for workspace layout"
```

---

### Task 5: Update CI workflows for monorepo paths

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`

**Step 1: Update ci.yml**

The CI commands (`bun run type-check`, `bun test`, `bun run build`, `bun run lint`) are now delegated by the root scripts to `packages/zodvex/`. Since we added root scripts that `--cwd` into the library, the CI commands stay the same — they just run root scripts.

BUT: `bun install --frozen-lockfile` needs to work with the new workspace layout. Verify the lockfile is committed (Task 4).

Read the current `ci.yml` and verify no path changes are needed. The root scripts handle the delegation. If any steps reference paths directly (like `src/` or `__tests__/`), update them to `packages/zodvex/src/` etc.

Looking at the current ci.yml:
- `bun run type-check` — delegates via root script, OK
- `bun test` — delegates via root script, OK
- `bun run build` — delegates via root script, OK
- `bun run lint` — delegates via root script, OK

No changes needed to ci.yml since root scripts delegate.

**Step 2: Update release.yml**

The release workflow runs `npm publish`. This must run from `packages/zodvex/` since that's where the publishable `package.json` lives.

Change the publish step:

```yaml
      - name: Publish to npm
        run: cd packages/zodvex && npm publish --access public
```

Also update the build and test steps to use root scripts (they already do via `bun run build` / `bun test`).

**Step 3: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "ci: update release workflow for monorepo layout"
```

---

### Task 6: Update CLAUDE.md for new paths

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update paths in CLAUDE.md**

Update any file path references that changed:
- `src/` → `packages/zodvex/src/`
- `__tests__/` → `packages/zodvex/__tests__/`
- Command references should note they can be run from root (delegated) or from `packages/zodvex/` directly.

Read the current CLAUDE.md and update only the paths and commands that changed. Don't rewrite sections that are still accurate.

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md paths for monorepo layout"
```

---

### Task 7: Verify everything works end-to-end

**Step 1: Build the library**

```bash
bun run build
```

Expected: succeeds, dist/ created in `packages/zodvex/dist/`

**Step 2: Run all tests**

```bash
bun test
```

Expected: 621+ tests pass

**Step 3: Type check**

```bash
bun run type-check
```

Expected: no errors

**Step 4: Lint**

```bash
bun run lint
```

Expected: no new errors

**Step 5: Verify npm pack**

```bash
cd packages/zodvex && npm pack --dry-run 2>&1 | head -20
```

Expected: lists the files that would be published — `dist/`, `src/`, `README.md`, `LICENSE`. No `examples/`, no `__tests__/`.

Note: `README.md` and `LICENSE` are at the repo root, not in `packages/zodvex/`. If npm pack doesn't include them, copy or symlink them into `packages/zodvex/` before publishing. Check the output and fix if needed.

**Step 6: Verify example codegen still works**

```bash
cd packages/zodvex && bun run build && cd ../../examples/task-manager && bunx zodvex generate convex
```

Expected: generates `_zodvex/` files successfully.

**Step 7: Verify no infinite loop in Time Machine path**

```bash
find examples/task-manager/node_modules/zodvex -maxdepth 2 -type d 2>/dev/null | head -20
```

Expected: normal directory structure, no `examples/` nested inside.

**Step 8: Commit any fixes**

If any verification step revealed issues, fix them and commit.

```bash
git add -A
git commit -m "fix: address monorepo migration verification issues"
```
