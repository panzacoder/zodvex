# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `panzacoder/zodvex`.
Use the `gh` CLI from this clone; it infers the repository from the remote.

## Conventions

- Create: `gh issue create --title "..." --body-file <path>`.
- Read: `gh issue view <number> --comments`; include labels when fetching JSON.
- List: `gh issue list --state open --json number,title,body,labels,comments`,
  with appropriate label and state filters.
- Comment: `gh issue comment <number> --body-file <path>`.
- Apply or remove labels: `gh issue edit <number> --add-label "..."` or
  `--remove-label "..."`.
- Close: `gh issue close <number> --comment "..."`.

For multiline bodies and comments, write the exact text to a temporary file
and pass it with `--body-file`.

## Pull requests as a triage surface

**PRs as a request surface: no.**

If enabled later, use `gh pr` equivalents for reading, commenting, labelling,
and closing. External PRs enter triage; maintainer PRs represent ongoing work.
GitHub shares issue and PR numbers: resolve ambiguous references with
`gh pr view <number>`, falling back to `gh issue view <number>`.

## Skill operations

When a skill says "publish to the issue tracker", create a GitHub issue.
When it says "fetch the relevant ticket", run
`gh issue view <number> --comments`.

## Wayfinding operations

- Map: one issue labelled `wayfinder:map`, holding Notes, Decisions-so-far,
  and Fog.
- Child ticket: link an issue to the map as a GitHub sub-issue. If unavailable,
  add it to a task list in the map and put `Part of #<map>` in the child body.
  Use `wayfinder:<type>` labels: research, prototype, grilling, or task.
- Blocking: use native issue dependencies. Add an edge with
  `gh api --method POST repos/panzacoder/zodvex/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`.
  Fetch the database ID with
  `gh api repos/panzacoder/zodvex/issues/<number> --jq .id`.
  If dependencies are unavailable, use a `Blocked by: #<number>` line.
- Frontier: inspect the map's open children in map order, excluding assigned
  tickets and tickets with open blockers. Select the first eligible ticket.
- Claim: `gh issue edit <number> --add-assignee @me` before starting work.
- Resolve: comment with the answer, close the child, then append a gist and
  link to the map's Decisions-so-far.
