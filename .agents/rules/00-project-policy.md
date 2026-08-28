---
trigger: always_on
---

# Movie Mood — Antigravity Workspace Policy

Read and follow @AGENTS.md before modifying this repository.

Treat @AGENTS.md as the repository-level agent authority.

When a version-specific implementation specification exists under `docs/`, treat the applicable specification as the source of truth for that version.

## Working style

For normal Movie Mood tasks:

1. identify the specific feature, bug, or documentation area involved;
2. inspect only the relevant files and nearby dependencies;
3. avoid repository-wide re-audits unless the task genuinely requires one;
4. implement the smallest coherent solution that satisfies the request;
5. run the relevant tests;
6. run the production build when appropriate;
7. inspect the final diff and git status;
8. report the result clearly.

Reuse repository knowledge already established in the current conversation.

Do not repeatedly re-read unchanged architecture or configuration files once they have been understood.

## Repository discipline

Preserve the existing architecture, conventions, and product principles defined in @AGENTS.md and the applicable version specification.

Use existing dependencies and project tooling.

Do not install, remove, or update dependencies unless explicitly requested.

Do not change unrelated code while completing a focused task.

Do not silently rewrite architecture, data conventions, product semantics, or documented version scope.

## Validation

For code changes, use the repository's existing validation commands.

At minimum, run the tests relevant to the change.

For changes that can affect compilation or production behavior, also run the existing production build.

If a validation step fails:

* diagnose the failure;
* distinguish pre-existing failures from failures introduced by the current change;
* fix only failures within the requested scope unless instructed otherwise.

Before completion, inspect:

* `git diff`;
* `git status --short`.

Do not leave unintended generated or temporary files.

## Git and remote state

Do not commit, push, tag, release, merge, or otherwise modify remote repository state unless explicitly requested.

Do not discard existing user changes.

Do not use destructive Git operations merely to simplify cleanup.

## Antigravity Git override

For Antigravity, a request to implement, execute, or complete a project phase
does NOT by itself authorize staging, committing, pushing, tagging, releasing,
or synchronizing with a remote.

Even if AGENTS.md describes commit/push as part of a phase workflow, treat
those actions as requiring explicit user authorization in the current
conversation.

Unless the user explicitly requests Git state changes, finish implementation
with the working tree changes present for review and report:

- validation results;
- git diff;
- git status.

Never infer permission to push to `origin/main` from a request to implement a
phase.

## External systems

Do not access files outside this repository for ordinary Movie Mood development.

Do not modify Hermes, Antigravity, browser, account, or machine configuration as part of a Movie Mood coding task.

Do not enable MCP integrations or external automation unless explicitly requested.

## Completion

A normal implementation task should proceed efficiently through:

targeted inspection → implementation → tests → build/check → diff/status review → concise report

Do not interrupt this flow with unnecessary confirmation requests for ordinary workspace-local actions already permitted by Antigravity.