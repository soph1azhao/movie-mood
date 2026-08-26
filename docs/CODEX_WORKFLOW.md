# Codex Development Workflow

For each implementation phase, assess the risk of the change before committing.

## Low risk

Examples:

- documentation
- copy
- simple CSS
- trivial presentational changes

Before commit:

1. Run the relevant build/check.
2. Run `git status --short`.
3. Confirm only expected files changed.
4. Commit if checks pass.

## Medium risk

Examples:

- React component behavior
- state wiring
- new selectors or controls

Before commit:

1. Run the build.
2. Inspect the diff for changed files.
3. Verify the primary behavior added in this phase.
4. Confirm no unrelated files changed.
5. Commit if checks pass.

## High risk

Examples:

- filtering logic
- fallback logic
- recommendation cycling
- persistence/localStorage
- deployment configuration

Before commit:

1. Run the build.
2. Inspect the relevant diff.
3. Verify edge cases and invariants defined in the V2 spec.
4. Check for regressions in existing behavior.
5. Confirm only expected files changed.
6. Commit only after all checks pass.

After a successful commit:

1. Run `git status --short`.
2. Confirm the working tree is clean.
3. Push only when requested or when the current task explicitly includes pushing.
4. After push, confirm local `main` and `origin/main` are aligned.

Do not perform heavyweight verification when a lower-risk change does not justify it.
Prefer the smallest verification procedure that gives reasonable confidence.
