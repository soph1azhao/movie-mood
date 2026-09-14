# Contributing to Movie Mood

Movie Mood is a static, mood-first movie recommendation experience. Contributions should preserve its central product promise: help someone choose one film for tonight without turning the experience into a catalogue browser.

## Prerequisites

- Node.js matching the `engines.node` range in `package.json`
- pnpm 11

## Local setup

```bash
pnpm install --frozen-lockfile
pnpm dev
```

## Required checks

Before proposing a change, run:

```bash
pnpm test:runtime
pnpm build
pnpm exec tsc -b
```

Changes to `catalogue-pipeline/` should also run the relevant focused pipeline tests. The complete `pnpm test` command is a maintainer/research validation suite and may require preserved local ignored artifacts; do not commit generated research artifacts merely to make historical checks portable.

## Product and architecture boundaries

- Keep the deployed application static and client-side unless an accepted specification explicitly changes that architecture.
- Preserve the ownership boundary: **Movie Mood owns meaning. TMDB owns facts.**
- Preserve the mood-first decision flow and avoid adding browse-heavy mechanics by default.
- Keep offline catalogue-generation tools out of the browser runtime.
- Do not add runtime AI, a backend, a database, or authentication by default.
- Put reusable decision and data logic in testable utilities, and add focused tests when changing it.
- Do not commit credentials, provider responses containing sensitive data, local caches, or ignored production artifacts.

For the current product contract and repository-specific working rules, read [the documentation index](docs/README.md) and [AGENTS.md](AGENTS.md).

## Pull requests

Small pull requests and focused issues are welcome. Explain any user-visible behavior change and include the tests that protect it. Avoid mixing generated catalogue updates, pipeline changes, and interface redesigns in one pull request unless they are inseparable. Automated agents must follow [AGENTS.md](AGENTS.md).
