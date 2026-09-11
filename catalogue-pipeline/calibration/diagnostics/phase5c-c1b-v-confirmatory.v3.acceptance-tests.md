# Phase 5C C1b-V Confirmatory V3 Acceptance-Test Plan

## Scope and authority

This plan verifies candidate protocol `phase-5c-c1b-v-confirmatory.v3`. It specifies tests only and authorizes neither implementation nor execution. Every fixture is synthetic unless an immutable artifact is explicitly named. Tests make zero external network calls.

V3 is a new independent study after V2 terminated as `BLOCKED — DISCOVERY CORPUS EXCEEDS PREDECLARED PAGE BUDGET`. It is not V2.1, an amendment, a continuation, a V2 WAL replay, or a restart of the V2 candidate universe.

## Normative inherited V2 acceptance criteria

The unchanged criteria in `phase5c-c1b-v-confirmatory.v2.acceptance-tests.md` (raw SHA-256 `cad481ea0dc793dbb5ae45e7c5c49695da3e2d9855f11bd7541c2186215ab52e`) are incorporated by reference for:

- global isolation, stage gating, evidence blinding, boundary-pool isolation, and separation of Coverage from Efficacy;
- the complete Stage-0 WAL identity, hash-chain, durability, lifecycle-fault, recovery, locking, replay, scope, and no-silent-redispatch matrix;
- contract canonicalization, per-contract content hashes, ordered-manifest bundle hashing, reference integrity, mutation detection, and duplicate-key rejection;
- Stage-2 Wikipedia v2 viability and coverage semantics;
- Stage-3 evidence-blinded sequential human gold, with the V3 boundary-pool filename;
- Stage-4 label freeze and deterministic final 12 true plus 12 false cohort;
- Stage-4B shared K3-256k covariates;
- Stage-5 Arm 0 three-draw strict-majority design and E0 headroom rule;
- Stage-6 paired Arm 1 evidence projection and literal grounding;
- Stage-7 metrics, exhaustive verdict mapping, and operational-failure precedence;
- Stage-8 identity Canary selection, normalization, redaction, environment pin, and non-mutating interpretation;
- every unchanged forbidden-adaptation test.

### Normative substitution map

Apply exactly these substitutions to the incorporated V2 criteria:

| Registered V2 term | V3 substitution |
|---|---|
| `phase-5c-c1b-v-confirmatory.v2` | `phase-5c-c1b-v-confirmatory.v3` |
| `NOT_IDENTIFIABLE_IN_MAIN_V2_DESIGN` | `NOT_IDENTIFIABLE_IN_MAIN_V3_DESIGN` |
| `c1b-v2-boundary-pool.json` | `c1b-v3-boundary-pool.json` |
| future strict-band study “cannot auto-execute from V2” | future strict-band study “cannot auto-execute from V3” |
| V2 Stage-1 recruitment contract references and Stage-1 criteria | `stage1-recruitment-contract.v3` and the V3-specific Stage-1 criteria below |

Every deterministic namespace whose preimage consumes `protocolId` must consume `phase-5c-c1b-v-confirmatory.v3`, including `stage1-select`, `human-label`, `final-cohort`, and `identity-canary`.

No other inherited substantive threshold, operator, provider/model configuration, denominator, quota, selection count, normalization algorithm, redaction algorithm, or efficacy-verdict rule changes.

## Candidate artifact and history integrity

1. Assert protocol ID `phase-5c-c1b-v-confirmatory.v3`, protocol version `3`, and study type `new-independent-confirmatory-study`.
2. Assert V2 is identified as a completed blocked predecessor and its results are inadmissible to V3.
3. Assert the only V2 execution observations used are aggregate `total_pages` values 45 and 65.
4. Assert V2 raw responses are not referenced as V3 source data.
5. Assert V2 produced no source snapshot, candidate registry, semantic inference, Wikipedia acquisition, human gold, or Stage-2 execution.
6. Assert the V2 closure commit and closure-record path/hash match the accepted history.
7. Before and after every specification test, verify byte identity of the V2 protocol, contracts, acceptance plan, closure record, RUN_LOCK, WAL, and all seven live artifacts.
8. Assert no V3 runtime implementation, output directory, WAL, lock, or network call is created by these tests.

## Contract and hash architecture

1. Parse both V3 JSON artifacts with duplicate-key rejection and reject any repeated object member.
2. Assert the V3 bundle contains exactly nine contracts.
3. Assert the eight non-Stage-1 contract `canonicalContent` values and `contentHash` values exactly equal their V2 counterparts.
4. Assert the only new contract is `stage1-recruitment-contract.v3` version 1.
5. Independently RFC-8785/JCS canonicalize each `canonicalContent` and verify every `contentHash`.
6. Reconstruct the ordered manifest from computed hashes and verify `contractsBundleHash`.
7. Assert the protocol bundle ID, bundle hash, and every required-contract triple exactly match the V3 bundle.
8. Assert every stage-level contract reference/hash resolves to the ordered manifest.
9. Mutate each canonical payload and every pinned hash independently; require pre-execution rejection.

## Annual partition manifest

1. Assert exactly 45 cells and exactly the IDs `year-1980` through `year-2024`.
2. Assert cells appear in strictly ascending year order.
3. For each year YYYY, assert `releaseDateGte=YYYY-01-01`, `releaseDateLte=YYYY-12-31`, and `pageBudget=50`.
4. Programmatically enumerate every calendar date from 1980-01-01 through 2024-12-31 inclusive and assert it belongs to exactly one cell.
5. Assert the union equals exactly that full inclusive interval, including all leap days.
6. Assert no gap and no overlap at every adjacent year boundary.
7. Assert each cell maps to exactly one parent stratum and each mapping matches the five frozen decade ranges.
8. Assert parent quotas are exactly 24, 24, 33, 45, and 54 and sum to 180.
9. Independently JCS-hash `partitionManifest` and verify `partitionManifestHash`.
10. Reorder a cell, alter a boundary, page budget, parent mapping, ID, add/remove a cell, or split a cell; assert hash divergence and pre-live failure.
11. Assert no quarterly, monthly, vote-count, or adaptive partition mutation path exists.

## Exact request contract

1. Assert endpoint `/discover/movie` only.
2. Assert the provider-visible query key set is exactly `include_adult`, `include_video`, `language`, `page`, `primary_release_date.gte`, `primary_release_date.lte`, `sort_by`, `vote_count.gte`, and `vote_count.lte`—no missing, duplicate, or additional key.
3. Assert fixed values exactly: `include_adult=false`, `include_video=false`, `language=en-US`, `sort_by=primary_release_date.asc`, `vote_count.gte=200`, and `vote_count.lte=2000`.
4. Assert cell-specific bounds are read from the frozen annual manifest.
5. Reject a missing `page` query parameter.
6. Reject duplicate serialized `page` query parameters even when values are equal.
7. Reject non-integer page values, including fractional numbers, numeric strings, NaN, and infinities.
8. Reject page 0, negative pages, and page 51 or greater.
9. In Phase 1 accept only page 1; reject every page not authorized by the current phase.
10. In Phase 2 accept only integer pages >=2 explicitly present in the frozen pagination plan for that cell; reject an otherwise valid page belonging to another cell or absent from the current cell plan.
11. Add each possible extra query key independently and assert pre-dispatch rejection.
12. Assert `region` is absent as a key and serialized query parameter; reject duplicate, null, `OMITTED`, empty, or concrete values before dispatch.
13. Assert `cellId`, `stratumId`, `protocolId`, `requestPurpose`, and credentials are never provider-visible query keys.
14. Reject added language, country, genre, popularity, runtime, or convenience filters.
15. Assert provider order never selects candidates.
16. Assert every request uses Stage-0 `requestScope=universe` and an internal identity containing V3 protocol ID, Stage 1, cell/year, page, and request purpose without serializing those identity fields into the provider query.

## Page-1 gate and empty cells

1. Instrument dispatch; assert cells are traversed in ascending year order and only page 1 is requested during the gate.
2. Assert no page 2 or greater is dispatched before every required page-1 response passes and the pagination plan is durably frozen.
3. Require requested page and response page both equal 1.
4. Require integer `total_pages>=0`, integer `total_results>=0`, and array `results`; malformed values are `OPERATIONALLY_INCONCLUSIVE`.
5. Accept `total_pages=0` only with `total_results=0` and an empty results array; record an empty cell with `requiredPages=[]`.
6. Cross each inconsistent empty combination and assert `BLOCKED — INVALID EMPTY-CELL PAGINATION STATE`.
7. Accept `total_pages=50`.
8. For `total_pages=51`, assert `BLOCKED — ANNUAL CELL EXCEEDS PREDECLARED PAGE BUDGET` before page 2, splitting, truncation, sampling, cap increase, or later-cell probing.
9. Assert 2,250 is derived from 45 × 50 and is not evaluated as a separate global stop rule.
10. Assert quota sufficiency never permits early stopping.

## Frozen pagination plan

1. Build no plan until all 45 page-1 gates pass.
2. Assert every plan entry contains exactly cell ID, frozen `total_pages`, frozen `total_results`, and exact required pages.
3. Assert required pages are `[]` for zero and `[1..N]` for nonzero N.
4. Independently JCS-hash the complete plan; repeated construction and source-array permutations must yield the same `paginationPlanHash`.
5. Persist the plan and hash before any page 2 dispatch.
6. Reject a page outside the frozen plan before dispatch.
7. Missing planned pages, duplicate logical pages, page 51, dynamically added pages, or removed pages block corpus completion.
8. Assert the plan is never rewritten after persistence.
9. Assert canonical plan entries are ordered exactly `year-1980` through `year-2024`, independent of input or page-1 delivery order.
10. Permute logically identical page-1 source arrays and require byte-identical canonical pagination plans and identical `paginationPlanHash` values.
11. For an empty cell, assert its page-1 request and raw response remain in their canonical artifacts while `requiredPages=[]`.

## Provider drift and request pacing

1. For every later response, require `response.page` equal requested page.
2. Alter later `total_pages`; assert `BLOCKED — PROVIDER PAGINATION DRIFT` without plan mutation or extra requests.
3. Alter later `total_results`; assert the same drift status and fail-closed behavior.
4. Assert all transport dispatches are serial with concurrency exactly one.
5. Assert Phase 2 traversal is year ascending, then page ascending from 2 through the frozen total.
6. Using a monotonic fake clock, assert at least 250 milliseconds between every pair of actual transport-dispatch starts.
7. Assert completed WAL replay causes zero dispatches and therefore creates no artificial pacing requirement.
8. Assert automatic retry count, middleware retry count, and hidden SDK retry count are all zero.
9. Inject `UNKNOWN_IN_FLIGHT`; assert whole-run `OPERATIONALLY_INCONCLUSIVE` and zero replacement/compensation requests.

## Source snapshot boundary and completeness

1. Assert every nonempty cell contains exactly one logical occurrence for every page in `[1..total_pages]` before freeze.
2. Assert every empty cell retains its page-1 raw response but authorizes no additional page.
3. Reject missing, duplicated, unexpected, or mismatched logical pages before snapshot freeze.
4. Assert each raw occurrence retains source cell ID, requested page, and the exact complete TMDB result object.
5. Freeze the canonical request manifest, complete raw corpus, partition hash, pagination-plan hash, and `sourceSnapshotHash` before downstream decisions.
6. Instrument downstream functions and prove none runs if atomic source-snapshot persistence fails.
7. After freeze, attempt mutation, reordering, filtering, or field merging of the source corpus; require rejection and unchanged snapshot hash.
8. Assert reporting says the snapshot is the exact observed response corpus and never claims an atomic simultaneous TMDB database snapshot.
9. Construct the canonical payload with exactly the keys and values: V3 `protocolId`, numeric `stage=1`, `contractRef=stage1-recruitment-contract.v3`, frozen `partitionManifestHash`, frozen runtime `paginationPlanHash`, canonical `requestManifest`, and canonical `rawResponseCorpus`.
10. Independently verify `sourceSnapshotHash = SHA256(RFC8785_JCS(sourceSnapshotCanonicalPayload))` and assert `sourceSnapshotHash` is absent from its own preimage.
11. Mutate `protocolId`; require hash mismatch and reject without repair.
12. Mutate `stage`; require hash mismatch and reject without repair.
13. Mutate `contractRef`; require hash mismatch and reject without repair.
14. Mutate `partitionManifestHash`; require hash mismatch and reject without repair.
15. Mutate `paginationPlanHash`; require hash mismatch and reject without repair.
16. Mutate any nested request-manifest value; require hash mismatch and reject without repair.
17. Mutate any nested raw-response-corpus value; require hash mismatch and reject without repair.
18. Assert downstream consumers recompute and verify the persisted hash before partition validation, duplicate disposition, eligibility, exclusion, ranking, or selection.
19. Assert a mismatching persisted artifact is never silently repaired or accepted after local recomputation.
20. Canonically order `requestManifest` by cell year then page and `rawResponseCorpus` page entries by cell year then requested page.
21. Permute logically identical in-memory/delivery arrays and require byte-identical canonical request manifests, byte-identical canonical raw corpora, and identical `sourceSnapshotHash` values.
22. Assert canonical artifact order differs from WAL execution order: artifacts are year/page sorted while WAL preserves the actual two-phase dispatch sequence.

## Partition and duplicate integrity

1. Supply a usable release date inside its source annual cell; accept membership.
2. Supply a usable release date outside its source cell; assert `BLOCKED — PARTITION MEMBERSHIP VIOLATION` before duplicate disposition or filtering.
3. Supply identical same-ID complete objects more than once within one cell; collapse to one only after snapshot freeze.
4. Supply non-identical same-ID objects within one cell; assert `BLOCKED — SOURCE SNAPSHOT DUPLICATE CONFLICT`.
5. Supply the same TMDB ID in two annual cells with identical objects; assert `BLOCKED — CROSS-CELL TMDB ID CONFLICT`.
6. Repeat with non-identical objects; assert the same cross-cell status.
7. Assert no first/last wins, date/cell preference, merge, majority, or provider-order resolution.
8. Instrument and verify exact post-freeze order: hash verification; cell membership; cross-cell conflicts; within-cell duplicate disposition; factual eligibility; V3 exclusion; parent-stratum verification; ranking; selection.
9. Assert the V3-specific integrity ordering is intentional and differs from V2 only where annual partition validation requires it.

## Exclusion boundary

1. Build a new V3 exclusion manifest before the first V3 provider request and verify its V3 manifest hash.
2. Carry forward every substantive semantic, descriptive/Wikipedia, human-gold/labeling, candidate-specific development/tuning, incident, and frozen historical exposure.
3. Assert IDs appearing only on either V2 factual page-1 response are not added merely for that appearance.
4. Assert neither V2 raw response is read, copied, parsed into, or reused by the V3 source universe.
5. Assert only aggregate values 45 and 65 are present as V2 feasibility inputs.
6. Even if the underlying exclusion set is identical, assert the V2 manifest hash cannot be used as V3 manifest identity.
7. Assert conflicting metadata fails closed without first/last-wins resolution.
8. Assert the canonical exclusion payload has exactly `exclusions`, `manifestVersion=1`, and `protocolId=phase-5c-c1b-v-confirmatory.v3`.
9. Assert exclusions contain exactly `canonicalId`, `provenance`, `reasons`, `title`, and `tmdbId`; sort entries by numeric TMDB ID and allow exactly one entry per TMDB ID.
10. Assert every `provenance` and `reasons` array contains sorted unique strings.
11. Permute source and record ordering; require byte-identical canonical payloads and identical exclusion-manifest hashes.
12. Test conflicting non-null canonical IDs in both source orders; both yield `EXCLUSION_METADATA_CONFLICT`.
13. Test conflicting non-null titles in both source orders; both yield `EXCLUSION_METADATA_CONFLICT`.
14. Combine null with one non-null canonical ID/title in both source orders; both resolve to the same non-null value and hash.
15. Allow repeated identical non-null metadata values.
16. Independently verify `exclusionManifestHash = SHA256(RFC8785_JCS(canonicalExclusionPayload))` and assert the hash is absent from its own preimage.
17. Mutate each top-level field, nested exclusion field, provenance member, and reason member; require hash mismatch without silent repair.
18. Substitute the V2 protocol ID or V2 exclusion hash; require V3 binding failure even if exclusions are otherwise identical.
19. Assert a separate source-inventory/provenance artifact cannot add fields to or otherwise alter the canonical exclusion-hash payload.

## Deterministic selection

1. Apply factual eligibility exactly: release date within 1980-01-01 through 2024-12-31 and inclusive vote count 200 through 2000.
2. Assert no language, country, genre, popularity, or runtime admission quota/filter.
3. Recompute the exact preimage `phase-5c-c1b-v-confirmatory.v3|stage1-select|<stratumId>|<tmdbId>` and SHA-256 lexicographic order.
4. Assert a V2 protocol ID produces intentionally different rank hashes.
5. Assert exact parent quotas 24/24/33/45/54 and exactly 180 unique selected candidates.
6. Permute source occurrence, cell, and page arrays; after canonical source validation, require the same ordered registry.
7. Simulate a short stratum; assert `BLOCKED — INSUFFICIENT FRESH FACTUAL UNIVERSE` with no borrowing, replenishment, replacement, or query adaptation.

## Stage-1 terminal precedence

1. Programmatically encode the ordered terminal table from the V3 Stage-1 contract; implementation-defined precedence is forbidden.
2. Operational/WAL/transport/HTTP/malformed-payload failure wins unless a more specific frozen blocked rule owns the condition.
3. At the page-1 phase, verify invalid-empty state precedes annual over-budget evaluation where conditions are applicable.
4. At later-page enumeration, verify pagination drift terminates before source freeze.
5. On a frozen corpus containing multiple downstream defects, verify membership violation precedes cross-cell conflict, which precedes within-cell duplicate conflict, which precedes insufficiency.
6. Assert exactly one terminal status and no subsequent stage action for every synthetic failure combination.
7. Assert success occurs only after exact 180-registry persistence and yields `STAGE 1 COMPLETE — FRESH FACTUAL UNIVERSE FROZEN`.

## Completion criteria

The V3 specification candidate is internally conformant only when both JSON artifacts parse with duplicate-key rejection; all nine contract hashes and the ordered bundle hash verify; the 45-cell partition proves exact gapless, overlap-free coverage; every relevant inherited V2 criterion and every V3-specific criterion above passes without external network access; `git diff --check` passes; and all protected V2 specification, closure, WAL, lock, and live-artifact bytes remain unchanged.
