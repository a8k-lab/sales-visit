# Issue tracker: GitHub

Issues and PRDs live in GitHub Issues for `a8k-lab/sales-visit`.
Use the `gh` CLI from this clone; it infers the repository from the remote.

## Operations

- Create: `gh issue create --title "..." --body "..."`.
  Use a heredoc for multiline bodies.
- Read: `gh issue view <number> --comments`.
  Fetch labels and filter comments with JSON/jq when needed.
- List: `gh issue list --state open --json number,title,body,labels,comments`.
  Apply appropriate label/state filters.
- Comment: `gh issue comment <number> --body "..."`.
- Label: `gh issue edit <number> --add-label "..." --remove-label "..."`.
- Close: `gh issue close <number> --comment "..."`.

When a skill says “publish to the issue tracker”, create a GitHub issue.
When it says “fetch the relevant ticket”, read the issue with comments.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares issue and PR numbers. If a reference is ambiguous,
try `gh pr view <number>` and fall back to `gh issue view <number>`.

## Wayfinding operations

- Map: one issue labelled `wayfinder:map`, containing Notes,
  Decisions-so-far, and Fog.
- Child tickets: link as GitHub sub-issues. If unavailable, use a task
  list in the map and `Part of #<map>` in each child.
- Label children `wayfinder:<type>`:
  research, prototype, grilling, or task.
- Blocking: use native GitHub issue dependencies through `gh api`.
  POST `repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by`
  with `issue_id=<blocker database id>` (not its issue number).
  If unavailable, record `Blocked by: #<number>` in the child.
- Frontier: consider open children in map order; skip assigned tickets
  and those with open blockers.
- Claim: `gh issue edit <number> --add-assignee @me` as the session's
  first write.
- Resolve: comment with the answer, close the child, then append a
  summary and link to the map's Decisions-so-far.
