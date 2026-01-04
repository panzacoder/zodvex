# Commit, Push, and Create PR

Commit all staged and unstaged changes, push to remote, and create a pull request.

## Current State

```bash
git status --short
git log --oneline -5
git branch --show-current
git diff --stat
```

## Instructions

1. Review the changes above and write a concise commit message that focuses on the "why" not the "what"
2. Stage all changes with `git add -A`
3. Commit with the message (include the standard footer)
4. Push to origin (create upstream branch if needed with `-u`)
5. Create a PR using `gh pr create` with:
   - A clear title summarizing the change
   - A body with a brief summary and test plan
6. Return the PR URL when done
