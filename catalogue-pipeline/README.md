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

The first implemented tranche is deliberately small: schema files, inert config, a versioned voice-guide placeholder, deterministic validators, and tests. TMDB enrichment, model-provider adapters, classifier, writer, critic, pilot generation, benchmark harnesses, and production promotion are later phases.
