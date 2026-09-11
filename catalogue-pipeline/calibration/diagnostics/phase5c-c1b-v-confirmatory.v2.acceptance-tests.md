# Phase 5C C1b-V Confirmatory V2 Acceptance-Test Plan

## Scope

This plan verifies `phase-5c-c1b-v-confirmatory.v2`. It specifies tests only; it does not authorize or implement runtime behavior. All fixtures must be synthetic unless a frozen artifact is explicitly named. Tests must make zero external network calls.

## Global invariants

1. Assert the protocol ID is `phase-5c-c1b-v-confirmatory.v2`, version is `2`, and the frozen content hash matches the registered value.
2. Assert V2 is a new independent study and consumes no V1/V1.1 candidate, evidence, gold, inference, resolution, or incident result.
3. Assert every stage rejects execution until all predecessor gates pass.
4. Assert any operationally compromised artifact is rejected by every downstream consumer.
5. Assert protocol mutation after execution begins hard-fails before state or network activity.
6. Assert raw Wikipedia evidence never appears in human-label UI/state.
7. Assert gold, human rationale, rationale seed, class counts, and target deficits never appear in provider input.
8. Assert the boundary pool never appears in current-study inference, prompt construction, or verdict input.
9. Assert Coverage and Efficacy artifacts, estimands, denominators, and conclusions remain distinct.

## Stage 0: Crash-safe execution substrate

### WAL identity and hash chain

1. Accept a WAL whose sequence is contiguous, whose `prevRecordHash` links exactly, and whose SHA-256 `canonicalRecordHash` values recompute.
2. Reject duplicate, skipped, decreasing, negative, and non-integer sequence numbers.
3. Reject a first record whose previous hash is not the frozen genesis value.
4. Reject a record with a missing required identity field; allow `arm` and `drawIndex` to be null only when not applicable.
5. Reject changes to `studyId`, invocation identity, request hash, attempt ordinal, candidate, stage, arm, or draw index across an attempt lifecycle.
6. Reject hash-chain splicing, record reordering, record deletion, and canonical-payload mutation.

### Durability ordering

7. Instrument filesystem and transport calls; assert INTENT append occurs before WAL fsync and transport dispatch occurs only after that fsync completes.
8. Assert RESPONSE append and WAL fsync complete before parse/state advancement.
9. Assert TERMINAL append and WAL fsync complete before completed state advancement.
10. Assert critical artifact replacement orders temporary write, temporary-file fsync, atomic rename, and parent-directory fsync.
11. Inject failure at each durability step and assert no later step runs.

### Crash matrix and recovery

12. Crash before INTENT: assert no durable attempt exists and no network call occurred.
13. Crash after INTENT before dispatch without durable pre-dispatch TERMINAL: recover as `UNKNOWN_IN_FLIGHT`; forbid a network request.
14. Durably record a synchronous pre-transport failure as TERMINAL: recover as `PROVABLY_NOT_DISPATCHED`; permit only the frozen bounded transport retry policy.
15. Crash after possible dispatch before RESPONSE: recover as `UNKNOWN_IN_FLIGHT`, mark the full confirmatory run `OPERATIONALLY_INCONCLUSIVE`, and forbid automatic/manual/compensation draws.
16. Crash after RESPONSE before parse: recover from the durable response without issuing another network request.
17. Crash after parse before TERMINAL: recover from the durable response and deterministic parse result without issuing another request.
18. Crash after TERMINAL: recover as completed and replay from immutable state.
19. A trailing incomplete JSON/frame/checksum record yields `TORN_TRAILING_RECORD`; preserve the source WAL and read only the last valid hash-chain prefix.
20. Interior malformed record, checksum mismatch, or broken link yields `WAL_CORRUPTION` and `OPERATIONALLY_INCONCLUSIVE`; never truncate or rewrite the forensic WAL.

### Locking and replay

21. First runner acquires via exclusive create, fsyncs lock and parent directory, then proceeds.
22. Concurrent runner fails before state mutation or network dispatch.
23. A stale lock is never TTL-cleared automatically and requires explicit controlled-recovery review.
24. Completed-run replay produces byte-identical logical outputs and zero unintended network calls.
25. Assert the central invariant across all fault injections: no ambiguous state silently causes a new request.

### WAL schema — commonRequiredIdentityFields and scopeConditionalIdentityFields (F)

26. Assert `commonRequiredIdentityFields` includes exactly: `studyId`, `invocationId`, `attemptId`, `stage`, `requestScope`, `requestPurpose`, `requestHash`, `attemptOrdinal`, `timestamp`; reject any WAL record missing any of these.
27. Assert `candidateId`, `arm`, and `drawIndex` are NOT in `commonRequiredIdentityFields`; they are scope-conditional only.
28. Assert no `requiredIdentityFields` or `nullableWhenNotApplicable` fields exist in the frozen WAL schema; any implementation using those legacy fields fails spec verification before execution.
29. For `requestScope = "universe"`: assert `scopeId` is present and non-null, `candidateId` is null, `arm` is null, `drawIndex` is null; reject any deviation.
30. For `requestScope = "candidate"`: assert `candidateId` is present and non-null, `arm` is null, `drawIndex` is null; reject any deviation.
31. For `requestScope = "inference"`: assert `candidateId`, `arm`, and `drawIndex` are all present and non-null; reject any record with any of these null or absent.
32. Assert `requestPurpose` is present and non-empty on every WAL record regardless of scope; reject any record without it.
33. Assert a WAL record with an unrecognized `requestScope` value is rejected before state mutation or network dispatch.
34. Inject a `universe`-scoped record with a non-null `candidateId`; assert rejection before state mutation.
35. Inject an `inference`-scoped record with a null `arm`; assert rejection before state mutation.

## Contract immutability and hash verification (B)

1. For each of the 9 contracts, independently RFC-8785 canonicalize the `canonicalContent` value, compute SHA-256, and assert it equals the stored `contentHash`; any mismatch is a specification tamper failure.
2. Assert that the `contentHash` field itself is excluded from the hash input (i.e., hashing the entire contract object without removing `contentHash` must not produce the stored `contentHash`).
3. Reconstruct the `orderedContractManifest` from computed `contentHash` values and assert the RFC-8785 canonical serialization of the manifest hashes to the stored `contractsBundleHash`.
4. Mutate a single byte in any `canonicalContent` value; assert the recomputed hash diverges from the stored `contentHash` and the bundle hash fails.
5. Mutate `contractsBundleHash` by a single hex character; assert downstream bundle-integrity validation rejects the contracts file before any execution phase begins.
6. Assert the main protocol `contractBundle.contractsBundleHash` equals the independently recomputed bundle hash from the contracts file; any divergence is a hard pre-execution failure.
7. Assert all 9 entries in `contractBundle.requiredContracts` exactly match the `orderedContractManifest` entries in the contracts file (id, version, contentHash); any mismatch is a hard pre-execution failure.
8. Mutate any contract hash inside `contractBundle.requiredContracts`; assert hard failure before any execution or network activity.
9. Assert stage-level `contractRef`/`contractHash` fields (Stage 1, 4B, 5, 6, 8) match the corresponding `contractBundle.requiredContracts` entries; any divergence is a hard pre-execution failure.
10. Verify the duplicate-key protection rule: parse all three V2 specification artifacts using a duplicate-key-detecting parser or raw-token scan; assert zero duplicate member names in any JSON object.

## Stage 1: Fresh factual candidate universe

1. Assert exactly 180 materialized candidates.
2. Assert exact temporal quotas: 24 for 1980–1989, 24 for 1990–1999, 33 for 2000–2009, 45 for 2010–2019, and 54 for 2020–2024.
3. Assert every candidate has `200 <= vote_count <= 2000`.
4. Assert every release date is on or before `2024-12-31` and inside its assigned temporal stratum.
5. Assert no duplicate canonical ID or TMDB ID.
6. Assert zero overlap with either C1b-V1 Stage-1 registry.
7. Assert zero overlap with C1b-V1 human-gold, Wikipedia-exposed, incident, or resolution candidates.
8. Assert zero overlap with all prior Phase-5 semantic/development exposure-ledger entries and all other semantic/descriptive exposure records.
9. Assert appearance only in a broad, non-materialized TMDB discovery page does not trigger exclusion.
10. Assert the exclusion manifest is deterministic under input reordering and has a stable SHA-256 hash.
11. Assert every exclusion has explicit provenance and union membership.
12. Simulate one deficient stratum; assert `BLOCKED — INSUFFICIENT FRESH FACTUAL UNIVERSE` and no quota borrowing.
13. Assert no language, country, or genre quota affects admission; those fields are disclosure-only.
14. Assert no replenishment batch can be created.
15. Assert TMDB endpoint used is `/discover/movie` with `include_adult=false`, `include_video=false`, `language=en-US`, and the `region` parameter entirely omitted from the request; any other endpoint or parameter set hard-fails.
16. Assert `sort_by=primary_release_date.asc`; any other sort order hard-fails.
17. Assert page 1 is fetched first and its response determines `total_pages`; if `total_pages <= 50`, all pages `1..total_pages` are fetched; no early stop is permitted after quota sufficiency.
18. Assert `total_pages > 50` yields `BLOCKED — DISCOVERY CORPUS EXCEEDS PREDECLARED PAGE BUDGET` before any further page fetch; any alternative behavior (truncating to the first 50 pages, continuing past page 50, or accepting partial results) hard-fails.
19. Assert page 51 is never fetched regardless of `total_pages`.
20. Assert the raw TMDB response corpus is frozen to a content-addressed snapshot (`sourceSnapshotHash`) before any deduplication, factual-eligibility filtering, or exclusion-manifest filtering.
21. Assert the same frozen source snapshot, processed through the frozen post-freeze operation sequence, produces the same ordered 180 selected candidates regardless of source-record/page delivery ordering. Reordering the frozen processing stages is not permitted.
22. Assert no server-side TMDB ID tie-break assumption is made; within-stratum determinism relies solely on `SHA256(protocolId|stage1-select|stratumId|tmdbId)` lexicographic ordering.

## Stage 1: Duplicate-key protection and region-omission tests (C)

1. Parse each V2 specification artifact using a duplicate-key-detecting parser (e.g., node `--check-duplicate-keys` or equivalent raw-token scan); assert zero duplicate member names in every JSON object across all three files.
2. Assert the serialized TMDB request URL/query-string contains no `region` key in any form; specifically assert: `region` key absent, `region=null` absent, `region=OMITTED` absent, and any concrete region value absent.
3. Assert the contract definition uses `omittedParameters: ["region"]` and that the serialization layer reads this list and explicitly omits those parameters from the TMDB request.
4. Assert `"region": null` in a serialized request hard-fails contract conformance before network dispatch.
5. Assert `"region": "OMITTED"` in a serialized request hard-fails contract conformance before network dispatch.
6. Assert any concrete region value (e.g., `"region": "US"`) in a serialized request hard-fails contract conformance before network dispatch.
7. Assert each stratum object in the contract carries explicit `releaseDateGte` and `releaseDateLte` fields; assert the serialization layer reads these fields and uses them to set `primary_release_date.gte` and `primary_release_date.lte` in the TMDB request.
8. Assert no `requestParameters` key exists in the stage1-recruitment-contract.v2 canonicalContent; any implementation that reads `requestParameters` fails spec conformance.
9. Supply repeated records with the same TMDB ID and byte-identical RFC-8785 canonical complete result objects; assert they collapse to exactly one logical record after `sourceSnapshotHash` freezes and before factual eligibility.
10. Permute the input order and page positions of identical duplicate objects; assert the same one-record logical result.
11. Supply two non-identical complete result objects with the same TMDB ID; assert exactly `BLOCKED — SOURCE SNAPSHOT DUPLICATE CONFLICT`.
12. Assert there is no first-wins, last-wins, page-order, popularity, field-merge, majority-value, or latest-value resolution path.
13. Instrument post-freeze processing; on a duplicate conflict, assert factual eligibility, exclusion filtering, stratum verification, and candidate ranking never begin.
14. Before and after identical-duplicate collapse and conflicting-duplicate rejection, assert the canonical request manifest, raw source corpus, and `sourceSnapshotHash` remain byte-identical.

## Stage 2: Machine-only Wikipedia viability

1. Assert Stage 2 accepts exactly the frozen 180 Stage-1 candidates and cannot add or substitute candidates.
2. Assert identity, allowed-section, paragraph-filter, normalization, and provenance policy identities equal the frozen Wikipedia V2 values.
3. Assert eligible word count is measured after frozen normalization/filtering and before inference excerpt truncation.
4. Assert 149 eligible words is `NON_VIABLE`; 150 and above is `VIABLE` when all other requirements pass.
5. Assert only frozen allowed reception-family headings are accepted and precedence is unchanged.
6. Assert no Plot, alternate heading, other-language Wikipedia, alternate source, or replenishment fallback occurs.
7. Assert each candidate terminates as exactly one of `VIABLE` or `NON_VIABLE`.
8. Inject `UNKNOWN_IN_FLIGHT`, unresolved transport, provenance, identity execution, and technical states; each must produce `BLOCKED — COVERAGE EXECUTION INCOMPLETE` and prohibit Stage 3.
9. Assert Stage 3 becomes eligible only when all 180 technical statuses are determinate.
10. Assert the human-label interface and export contain no heading, word count, evidence, evidence hash, viability, or failure-reason metadata.
11. For known `(viable, n=180)` fixtures, verify point estimate and 95% Wilson interval against independent reference values, including 0/180 and 180/180 boundaries.
12. Verify identity-resolution, allowed-section, and >=150-word rates use their documented denominators.
13. Verify failure-reason counts are mutually exclusive and sum to non-viable candidates.
14. Verify release decade, vote-count band, language, country, genre, and runtime-band coverage tables reconcile to overall coverage, including multi-valued field denominator disclosure.
15. Assert `coverageByFriendsGold` is exactly `NOT_IDENTIFIABLE_IN_MAIN_V2_DESIGN` and no gold-conditioned coverage calculation exists.
16. Assert Coverage freezes before any human gold exists.

## Coverage semantics

1. Assert reported coverage formula is `k / 180` where `k` is the count of VIABLE candidates; confirm `exactObservedFrozenUniverseCoverage` matches this formula.
2. Assert `descriptiveBinomialReferenceOnly = true`; assert no population-inference output is emitted.
3. Assert `populationInferenceAuthorized = false`; any attempt to emit a population-level conclusion hard-fails.
4. Assert `fullCatalogueConfidenceInterval = false`; the Wilson 95% interval is labeled as a descriptive reference for the frozen 180-candidate universe only.
5. Verify the Wilson interval label text asserts it cannot be interpreted as a catalogue-level or population-level confidence interval.
6. Assert the Coverage estimand denominator is always 180, not the count of VIABLE candidates, the production catalogue size, or any other count.

## Stage 3: Evidence-blinded sequential human gold

1. Assert only Stage-2 `VIABLE` candidates enter the ordering pool.
2. Recompute `SHA256(protocolId + "|human-label|" + canonicalId)` and assert lexicographic ascending order independent of title, year, vote count, genre, popularity, or labels.
3. Assert labeler-visible data is neutral factual data only.
4. Assert required provenance metadata states evidence fetched before gold, labeler not exposed to evidence, and no semantic model output before gold.
5. Assert `friendsGold` accepts only boolean values and confidence accepts only high/medium/low.
6. Count rationale seeds by Unicode code points, not bytes or UTF-16 units; accept 80 and reject 81.
7. Assert rationale seed is optional and is absent from provider input, semantic evidence, cohort selection, and verdict input.
8. Assert the initial tranche is exactly 48 and increments are exactly 8.
9. Assert checkpoints occur only at 48, 56, 64, and 72 completed labels.
10. At each checkpoint expose only `STOP — GOLD TARGET REACHED` or `CONTINUE — NEXT PRE-REGISTERED TRANCHE` to the labeler.
11. Assert current class counts and deficits never appear in UI, logs intended for the labeler, or exported worksheet state.
12. Assert labeling stops at the first checkpoint where both high/medium classes reach 12.
13. Exercise first success at 48, 56, 64, and 72; verify no later tranche is exposed.
14. At 72 without both targets, return `BLOCKED — INSUFFICIENT HIGH/MED GOLD CLASS COUNT` and prohibit further labels.
15. If viable candidates are exhausted before a required checkpoint/target, return `BLOCKED — EVIDENCE-ELIGIBLE POOL EXHAUSTED`.
16. Assert no factual or Wikipedia mining is triggered after Stage 1/2.
17. Assert every low-confidence record is stored in `c1b-v2-boundary-pool.json` and may be counted.
18. Before final verdict, assert boundary-pool content cannot be analyzed, used for prompt changes/examples, or exposed to models.

## Stage 4: Label freeze and final 24

1. Assert all completed Stage-3 gold, confidence, and rationale seeds freeze before selection.
2. Reject selection if either high/medium class has fewer than 12 records.
3. Recompute `SHA256(protocolId + "|final-cohort|" + canonicalId)` independently within each class.
4. Assert exactly the first 12 true and first 12 false hashes are selected, for exactly 24 unique candidates.
5. Assert selection is deterministic under source-array reordering.
6. Assert full human rationale and `reflectionChanged` are requested only for the selected 24.
7. Assert rationale entry may display the original seed but no Wikipedia or model data.
8. Attempt to mutate gold, confidence, or cohort during reflection; hard-fail and retain frozen values.
9. Toggle `reflectionChanged`; assert no change to gold, confidence, membership, provider input, predictions, metrics, or verdict.

## Stage 4B: Shared MODEL-DERIVED SEMANTIC COVARIATES

1. Assert Stage 4B does not begin until all Stage 4A label-freeze and cohort-selection fields are immutable.
2. Assert Stage 4B makes exactly one provider call per final-24 candidate; exactly 24 calls total. Any attempt to issue a second call for the same candidate hard-fails without provider contact.
3. Assert the provider is Kimi `k3-256k`, temperature 1, reasoning effort high, stateless.
4. Assert stateless invocation: no conversational history, no session linkage, and no authorship wording appear in any call.
5. Assert outputs are exactly `pace`, `emotionalWeight`, and `attentionDemand`; any missing or additional axis is `OPERATIONALLY_INCONCLUSIVE`.
6. Assert forbidden provider-visible inputs: Wikipedia evidence, `friendsGold`, `confidence`, `rationaleSeed`, and `humanRationale` must not appear in any Stage 4B provider-visible payload.
7. Inject `UNKNOWN_IN_FLIGHT` on any of the 24 calls; assert the whole Stage 4B run is `OPERATIONALLY_INCONCLUSIVE` with no retry, repair prompt, or replacement call.
8. Inject a missing or schema-invalid required structured output on any of the 24 calls; assert `OPERATIONALLY_INCONCLUSIVE` with no retry, repair, or model substitution.
9. Assert the content-hashed per-candidate covariate snapshot is frozen before Arm0 begins.
10. Assert Arm0 and Arm1 consume the exact same frozen covariate snapshot hash per candidate; any divergence is a hard contract failure.
11. Assert covariates are labeled `MODEL-DERIVED SEMANTIC COVARIATES` in all outputs, reports, and exports; no other label is permitted.

## Stage 5: Arm0

1. Assert provider/model/config are Kimi, `k3-256k`, temperature 1, reasoning effort high.
2. Assert 24 films × 3 draws produces exactly 72 required draw identities.
3. Assert draw indices 1, 2, and 3 create distinct cache/WAL identities while all other fields remain fixed.
4. Assert each identity includes protocol, candidate, arm, draw index, provider/model/config, prompt/schema, canonical input hash, and WAL invocation identity.
5. Replay a completed draw identity; assert exact cached artifact and zero provider calls.
6. Verify majority truth table: TTT→T, TTF→T, TFF→F, FFF→F.
7. Assert no confidence weighting, rationale voting, fourth draw, or tie-break draw path exists.
8. Remove or invalidate any required draw; return `OPERATIONALLY_INCONCLUSIVE` without aggregation or replacement.
9. Mark any draw `UNKNOWN_IN_FLIGHT`; return whole-run `OPERATIONALLY_INCONCLUSIVE` and issue no replacement call.
10. Assert aggregation produces exactly 24 film-level booleans.
11. Assert `arm0Errors = FP + FN` over the 24 majority predictions, not 72 individual draws.
12. Set E0=4; assert `INCONCLUSIVE — INSUFFICIENT BASELINE HEADROOM` and Arm1 prohibition.
13. Set E0=5; assert Arm1 authorization, assuming all other contracts pass.

## Stage 6: Arm1

1. Assert Arm1 cannot begin unless Stage 5 completed and E0>=5.
2. Assert 24 films × 3 draws produces exactly 72 required Arm1 identities.
3. Byte/structure-compare paired inputs: Arm1 equals exact Arm0 semantic input plus one frozen Wikipedia descriptive-evidence block.
4. Reject any other difference in factual fields, axes, prompt, schema, provider/model/config, or ordering.
5. Assert each draw uses the same candidate-specific frozen evidence artifact and hash.
6. Accept a literal grounding quote only when it verifies against the exact supplied excerpt.
7. Reject missing, fabricated, normalized-mismatch, or out-of-excerpt grounding per the frozen validator.
8. Assert invalid/missing required draw yields `OPERATIONALLY_INCONCLUSIVE`, with no repair prompt, replacement, or fourth draw.
9. Replay all completed Arm1 draws; assert zero provider calls.

## Stage 7: Frozen efficacy verdict

### Metric correctness

1. Verify TP/FP/FN/TN, precision, recall, F1, specificity, and balanced accuracy against hand-calculated fixtures, including zero-denominator conventions.
2. Verify corrected errors, introduced errors, introduced FP, introduced FN, and net error reduction from paired film-level predictions.
3. Verify the exact paired McNemar/binomial discordant-pair statistic and two-sided p-value against independent reference calculations, including zero discordant pairs.
4. Assert McNemar outputs are descriptive and cannot change a verdict.

### Precedence and exhaustive mapping

5. Operational/contract failure always maps to `OPERATIONALLY INCONCLUSIVE`, regardless of metrics.
6. With no operational failure, E0<5 always maps to `INCONCLUSIVE — INSUFFICIENT BASELINE HEADROOM`.
7. With gates 1–2 clear, `introducedErrors > correctedErrors` maps to `EVIDENCE DEFECT — NO-GO`.
8. With gates 1–2 clear, `introducedFalsePositives >= 3` maps to `EVIDENCE DEFECT — NO-GO` regardless of other secondary thresholds.
9. Verify C=3, I=1 and all secondary thresholds passing maps to `PROMOTION GO`.
10. Verify C=3, I=2 maps to `PARTIAL / HOLD` when defect criteria do not apply.
11. Verify C=1, I=0 maps to `NO MATERIAL BENEFIT`.
12. Verify C=3, I=3 maps to `NO MATERIAL BENEFIT` when defect criteria do not apply.
13. Verify C=2, I=3 maps to `EVIDENCE DEFECT — NO-GO`.
14. Verify `introducedFP=3` maps to `EVIDENCE DEFECT — NO-GO`.
15. Programmatically enumerate every integer `(C,I)` with `0 <= C <= 24`, `0 <= I <= 24`, and `C+I <= 24`, crossed with all reachable introduced-FP values and boundary truth values for F1 improvement, precision 0.80, and recall 0.75.
16. For every enumerated state, assert exactly one verdict is returned and that it is the first matching frozen precedence clause.
17. Add mutation tests changing each threshold/operator by one boundary step; assert at least one exhaustive case fails.

## Stage 8: Identity Canary

1. Preselect canaries from the frozen final 24 before semantic outcomes exist.
2. Assert exactly three true and three false candidates using a distinct frozen hash namespace.
3. Assert selection is deterministic under input reordering and does not consume semantic outcomes.
4. Freeze canonical/alternate-title identity matching rules before Canary outputs exist; reject post-outcome alias additions. Assert `noPostHocAliases = true` is enforced: any attempt to add a new accepted alias after the Canary output is produced hard-fails.
5. Reidentification is positive only for correct canonical identity and confidence >=80; verify 79 fails and 80 passes.
6. For 0–3 positives, assert no cohort caveat; for 4–6, append `COHORT VALIDITY CAVEAT`.
7. Assert Canary result never alters the already-frozen semantic verdict.
8. If verdict is `PROMOTION GO` and Canary is >=4/6, assert Phase-6 production authorization is conditional on a future independent 200–800 strict-band study.
9. Assert the strict-band study is represented as future-only and cannot auto-execute from V2.
10. Assert all six one-shot Canary calls must produce canonical-valid results; any missing, malformed, schema-invalid, or `UNKNOWN_IN_FLIGHT` call among the six yields `CANARY_OPERATIONALLY_INCONCLUSIVE`.
11. Inject exactly 5 valid Canary results plus 1 `UNKNOWN_IN_FLIGHT`; assert `CANARY_OPERATIONALLY_INCONCLUSIVE` with no replacement call, no retry, and no denominator shrink to 5.
12. Inject exactly 5 valid Canary results plus 1 schema-invalid result; assert `CANARY_OPERATIONALLY_INCONCLUSIVE` with no repair, no replacement, and no denominator shrink.
13. Assert no Canary denominator shrink is permitted under any failure mode; the denominator is always 6.
14. Assert the accepted identity set is limited to the TMDB `title` and `original_title` fields frozen before Canary output; no post-hoc additions are permitted.

## Stage 8: Canary normalization and redaction algorithm tests (E)

1. Apply NFKC normalization to a string containing a compatibility decomposition character (e.g., `ﬁ` → `fi`); assert the result matches the expected NFKC form before further steps.
2. Apply Unicode lowercase conversion to a string containing an uppercase letter; assert locale-independent lowercasing (e.g., `Ü` → `ü`, not ASCII-only tolower).
3. Apply punctuation replacement: input `A.B-C` (period and hyphen are `\p{P}`) must become `A B C` (each punctuation replaced by one ASCII space).
4. Apply whitespace collapse: input `A  B\tC` must become `A B C` (each whitespace sequence replaced by one ASCII space).
5. Apply trim: input ` A ` must become `A`.
6. Assert all five steps are applied in the declared order; applying them out of order must produce a different result for at least one test input.
7. Assert no accent/diacritic stripping occurs: `café` must normalize to `café` (with accent preserved), not `cafe`.
8. Assert no transliteration occurs: a non-Latin string must remain in its original script after normalization.
9. Assert no fuzzy or edit-distance matching: `filmx` must not match the accepted identity `film`.
10. Assert no token reordering: `the film` and `film the` must not match after normalization.
11. Assert exact equality after normalization is required: two strings that differ by one character after normalization must not be considered a match.
12. Assert the same normalization algorithm is applied to both the frozen accepted identity set and the model `guessedTitle`; using different normalization for the two sides must be detected and rejected.
13. Assert redaction step 1 discards empty normalized dictionary entries; an empty entry must not trigger any redaction match.
14. Assert redaction step 2 deduplicates identical normalized entries; two identical entries must produce the same result as one.
15. Assert redaction step 3 sorts entries longest-first; for two overlapping entries of different length, the longer entry must be matched and replaced first.
16. For equal-length entries, assert lexicographic ascending order is used for determinism; verify that swapping the order of equal-length entries in the input still produces the same output.
17. Assert redaction step 5 matches only at Unicode letter/number boundaries; a match may not begin or end in the middle of a word.
18. Assert step 6 replaces every matched span with exactly the token `[REDACTED_IDENTITY]` — no other token, no partial replacement, no omission.
19. Assert all replacements are applied deterministically; identical input always produces byte-identical redacted output.
20. Assert surrounding text is not paraphrased; only the matched spans are replaced.
21. Assert no model-assisted redaction decisions are made; the redaction must be fully mechanical.
22. Assert Wikipedia page-title entries in the redaction dictionary are redacted from the excerpt.
23. Assert frozen known source URL entries in the redaction dictionary are redacted from the excerpt.
24. Assert director names already present in frozen metadata are redacted; director names not in the frozen snapshot are not added or redacted.
25. Assert cast names are redacted only when already present in the frozen factual snapshot; no additional cast lookup or TMDB call is made.
26. Assert zero additional TMDB or network calls are made during the redaction process.
27. Assert that post-hoc alias additions to the accepted identity set are rejected after the Canary output has been produced (`noPostHocAliases = true`).
28. Assert `guessedTitle` matching uses the same five-step normalization algorithm as the frozen accepted identity set; a `guessedTitle` that matches only after a different normalization is not accepted as positive.
29. Assert every candidate-specific redaction-dictionary string is transformed by `canaryRedactionNormalization` in the declared five-step order before matching.
30. Assert the exact frozen Stage-6 Arm1 excerpt is transformed by the same `canaryRedactionNormalization` into `normalizedCanaryEvidence` before redaction.
31. Assert Stage-6 Arm1 continues to receive its exact frozen efficacy excerpt unchanged; Canary normalization/redaction cannot mutate or replace that artifact.
32. Assert all redaction matching operates only on `normalizedCanaryEvidence`, never directly on the raw or Stage-6 excerpt.
33. Assert `redactedNormalizedCanaryEvidence` is the only Wikipedia evidence string visible to the Canary provider input; reject raw, merely normalized, or differently redacted excerpt variants.
34. Exercise start, end, and interior matches under the mechanical Unicode boundary rule: string boundaries pass; neighbors in General_Category Letter (L*) or Number (N*) reject; all other category neighbors permit the boundary.
35. Assert regex word-boundary semantics are non-normative and cannot substitute for the explicit preceding/following Unicode code-point L*/N* checks.
36. Assert the Canary execution environment is pinned to Node `v26.7.0`, Unicode `17.0`, and ICU `78.3`; any Unicode-data-version mismatch fails before the first Canary call.
37. Run the same frozen excerpt and dictionary twice under the frozen execution environment; assert byte-identical `normalizedCanaryEvidence` and byte-identical `redactedNormalizedCanaryEvidence`.

## Forbidden-adaptation tests

After execution begins, attempt each prohibited mutation independently and assert a pre-state/pre-network hard failure: TMDB vote bands, temporal quotas, replenishment, Wikipedia word threshold, accepted headings, language fallback, gold, confidence, label budget, cohort replacement, K3 configuration, draws per arm, tie-break draws, repair prompts/settings, verdict thresholds, and boundary-pool prompt use.

## Completion criteria

The V2 runtime may be considered conformant only when every test above passes, no test performs an unmocked network request, the protocol content hash remains unchanged, historical V1/V1.1 artifacts remain byte-identical, and coverage and efficacy outputs independently reconcile to their frozen denominators.
