---
name: gh44-join-implement
description: Build one Join Linear ticket with its operating-model context (plan task, composition, blockers, ticket footer), then run gh44-implement.
argument-hint: '<Linear ticket> [--here]'
disable-model-invocation: true
---

# Join implement

`/gh44-implement` for a ticket the operating model (OM) created. First collect what OM knows about the ticket, then build it with `gh44-implement`. Run it from the service or frontend repo, not from OM.

`$OM` is `$JOIN_OM`, else `~/Programming/Join/operating-model`. The steps below come from OM's `/join-implement` (`$OM/.agents/skills/join-implement/`); read its `reference/` files when a step needs detail.

## 1. OM context

1. Run `git -C $OM fetch --quiet`. When `main` is behind `origin/main`, say so in one line: a stale OM looks like a missing task.
2. Run `get_issue` with `includeRelations: true`. Take the `## Done when` bullets and the footer: `Branch:`, `Commit:`, `App / package:`, `Figma:`, `References:`. Mark a missing footer value as missing.
3. Claim: when the ticket is not started, `save_issue` it to the team's In Progress state and assign it to me. Started and assigned to someone else: stop and ask.
4. Find the project folder: `grep -rl "<ID>" $OM/projects/*/milestones/*/issues.md $OM/projects/*/issues.md`.
   - No hit, but the ticket has a project milestone: use that milestone's folder and warn that its `issues.md` misses the ticket.
   - No project: run `python3 $OM/.agents/scripts/ticket_drivers.py find <issue uuid>` and read the composition it names.
5. Read only this ticket's T-task in the milestone's `fe-plan.md` or `be-plan.md`, and its `## Design coordinates` row for Figma work. When behavior is unclear, read the composition's EARS clauses this ticket realizes.
6. Blockers: for each `blockedBy`, run `python3 $OM/.agents/scripts/check-blocker.py --side <fe|be> --state "<state name>" --state-type <type>`. Report a `blocking` result as a warning and keep going.
7. Authority when sources disagree: composition, capability spec, plan task, `issues.md`, ticket body. A ticket bullet the docs contradict is superseded: leave it unbuilt and name the doc.

Done when every line of this block is filled or marked missing:

```md
**Ticket:** <ID> <title> · <state> · <project / milestone>
**Task:** <plan path> <T-id>
**Branch:** <footer> · **Commit:** <footer> · **Scope:** <App / package>
**Blockers:** <each with its ladder result, or "none">
**Acceptance criteria:** <2-6, from Done when and the task's Tests; superseded ones marked>
**Conflicts:** <docs vs ticket, or "none">
```

## 2. Build with gh44-implement

Read `~/.claude/skills/gh44-implement/SKILL.md` and follow it from step 1, with:

- The acceptance criteria above as the criteria to confirm. Ask questions only for a gap the plan task leaves open.
- Worktree: in a linked worktree, stay, and say in one line when its branch differs from `Branch:`. Otherwise use `--worktree <Branch footer>`.
- `--here` when passed.
- For the implementer: the plan task's files and details, the scope and the Figma coordinates.
- OM files stay read-only. A change the contract needs stops the build: name `/join-plan-iterate` (plan) or `/join-clarify` (spec) for me to run in OM.

## 3. Report

The `gh44-implement` report, plus:

- `Done when`: each bullet met, unmet or superseded.
- `Next: /gh44-create-pr` with the `Commit:` prefix and the `Branch:` footer.
