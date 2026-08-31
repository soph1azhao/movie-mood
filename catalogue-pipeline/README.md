# Movie Mood Catalogue Pipeline

Maintainer-only offline tooling for V8.1 catalogue scale.

This directory is intentionally outside the runtime `src/` tree. It supports candidate validation, deterministic hard checks, semantic anomaly detection, and review queue preparation before any reviewed batch is promoted into the production static catalogue.

V8.1 guardrails:

- No runtime AI
- No runtime authenticated TMDB calls
- No backend or database
- No production catalogue writes from validation commands
- Complete editorial fields for every promoted movie
- Hard validation failures are separate from semantic review flags

Implemented pipeline stages are TMDB enrichment, the provider-neutral structured-output adapter, and semantic classification. The classifier accepts an injected maintainer-side provider module, writes only ignored semantic cache/generated artifacts, and never produces editorial copy. Editorial writing, critic execution, pilot generation, benchmarks, and production promotion remain later phases.
