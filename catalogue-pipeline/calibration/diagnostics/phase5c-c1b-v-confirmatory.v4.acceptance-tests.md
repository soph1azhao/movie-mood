# Phase 5C C1b-V4 Acceptance Tests

Status: **REGISTERED**

Protocol: `phase-5c-c1b-v-confirmatory.v4`

All tests in this plan are offline unless a later, separately authorized Stage-2 execution explicitly says otherwise. Registration testing must make zero TMDB, Wikipedia, model/provider, package-registry, or other external requests.

## 1. Registration identity and historical provenance

- Verify the registered protocol and contract bundle identify V4 and contain no `PENDING_STATIC_REGISTRATION` token or placeholder hash.
- Verify the historical relationship is an independent prospective successor importing the exact frozen V3 cohort, not an amendment to V3.
- Verify the triage audit reports `VERIFIED_NO_ADVERSE_EVIDENCE` and states exactly: “No adverse evidence of candidate-specific exposure was found across available logs, scripts, and Git history. This is an absence-of-adverse-evidence standard accepted as sufficient for this study.”
- Verify the audit accurately records the repository evidence inspected, candidate-ID comparison method, its bounded limitations, and zero network calls. It must not claim absolute non-exposure and must not require inspection of shell history, filesystem atime, DNS logs, proxy logs, browser history, or unrelated machine telemetry.

## 2. Imported V3 cohort

- Verify Stage 1 imports exactly 180 candidates from the frozen V3 candidate registry whose raw SHA-256 is `sha256:2755b9cb603f8fb4bdfdfe7aef46e7c44840ed3334ff9f393a45ec0db04bf11f`.
- Verify the V3 Stage-1 closure raw SHA-256 is `sha256:d7ebf19f03486da8faa3d907924fab4c10176d3c5150c9cba8273497bd5a348c` and the source closure commit is `2013e0f50df5ce8dc6fadd79bbf25cc63f54316e`.
- Verify V4 authorizes zero TMDB recruitment, reranking, replenishment, substitution, or factual refresh.

## 3. Contract materialization

- Assert exactly 11 materialized contracts: the three prospective V4 contracts and eight explicitly re-adopted V3 contracts listed in the protocol bundle manifest.
- Independently RFC-8785/JCS canonicalize each of the 11 `canonicalContent` values and verify every `contentHash`.
- Independently rebuild the ordered `{ id, version, contentHash }` manifest and verify the top-level `contractsBundleHash` using the registered bundle hashing semantics.
- Verify the eight re-adopted V3 contracts have JCS-identical canonical content to their complete V3 representations. Array order and all JSON value types remain significant.

## 4. Automatically derived executable closure

- Starting only from `catalogue-pipeline/adapters/wikipediaDescriptiveEvidenceV2.mjs`, recursively derive all reachable local runtime imports with the TypeScript compiler API. Type-only and unreachable development/test imports are excluded.
- Compare the derived membership with `wikipedia-executable-closure.v1.json`. Fail if a reachable material local dependency is omitted or if a non-reachable dependency is manually inserted as required.
- Fail if any derived material source is untracked at the frozen implementation commit or any pinned source raw hash differs.
- Derive the supported lockfile set from repository contents and fail if a frozen lockfile is omitted, inserted without support, or has a different raw hash.
- Verify the package-manager declaration and the single minimal `nodeEngine: ">=M.0.0"` field, where `M` was derived from `process.versions.node` during registration.
- Independently JCS-hash the completed manifest, excluding any self-referential hash field, and verify every protocol and contract binding.

## 5. Detached clean-checkout synthetic verification

- Create a disposable detached checkout at the frozen V4 implementation commit.
- Run `pnpm install --offline --frozen-lockfile`. If the local pnpm store is incomplete, stop and block registration; never fall back to an online install.
- Using only fixtures allowed by `tests/fixtures/wikipedia/provenance.json`, execute the real offline identity resolution → structural section selection → extraction → normalization/filtering → viability path.
- The synthetic path must resolve the declared synthetic film identity, select an allowed reception-family section, extract and normalize eligible prose, and determine viability at the unchanged threshold of 150 eligible normalized words. An import-only smoke test is insufficient.
- Assert all transport activity is satisfied by deterministic in-memory fixtures and external requests equal zero. Candidate-specific V4 Wikipedia outcomes are forbidden.

## 6. Frozen Stage-2 substantive policy

- Verify Stage 2 retains `wikipedia-film-identity-resolution.v1`, `wikipedia-reception-sections.v2`, `wikipedia-reception-extraction.v2`, and `wikipedia-reception-normalization-filter.v1` unchanged from registered V3.
- Verify the threshold remains 150 eligible normalized words and no identity rule, regex, section hierarchy, paragraph filter, normalization rule, threshold, or additional fallback was tuned.
- Verify fixture provenance remains bound to `tests/fixtures/wikipedia/provenance.json`.

## 7. JIT/RUN_LOCK invariant

- Statically verify the registered protocol and executable-closure contract require this order under one continuously held Stage-2 `RUN_LOCK`: acquire lock → JIT executable hash/provenance verification → permit no mutable semantic-policy operation → first Stage-2 HTTP dispatch → durable completion/recording of the first request.
- Verify the lock remains held through first-request durable completion. Do not execute an HTTP request as part of registration.

## 8. Regression and immutability gate

- Run the focused V4 registration tests, relevant static/contract tests, the full repository suite, `tsc -b`, and `git diff --check`.
- Verify all frozen V3 artifacts are byte-identical to committed V3 and no Stage-2 runner/network execution implementation was added.
- Verify zero external network requests and zero Stage-2 live executions occurred during registration.
