# Source-Boundary Risk Verifier v1.4 — Prospective Semantic Validation r2

- **Protocol ID:** `source-boundary-risk-verifier.v1.4-prospective-validation.r2`
- **Status:** `PREREGISTERED_DESIGN_ONLY_AWAITING_SEALING_AND_RESOURCE_CONFIRMATION`
- **Supersession:** r2 corrects the pre-execution design in `../PROTOCOL.md`; r1 remains immutable historical evidence.

## 1. Scope and claim discipline

This is a design-only prospective evaluation of the frozen v1.4 verifier.  Its separate targets are: natural-arm minor-defect routing, natural-arm clean false-positive burden, coverage-suite severe-challenge escape detection, technical/schema validity, and leakage/integrity.  Its unit is one immutable source-boundary verifier input packet, one blind human label, and one verifier result.  A PASS is evidence for a later, separate governance decision; it never promotes a production record or authorizes production.

The design is a two-arm study.  A representative sealed natural stream estimates observed routing behavior under its actual unknown mix.  A separately frozen severe challenge coverage suite exercises prespecified, production-relevant severe failure classes.  The arms are reported separately and are never pooled into one accuracy number or prevalence estimate.

The challenge-arm claim is intentionally narrow: a PASS means **zero escapes across the preregistered severe challenge coverage suite**.  It does not estimate natural severe prevalence, a general severe-error rate, or universal severe containment.  A natural human-SEVERE record, if encountered, is separately highly informative; a natural SEVERE record routed `LOW_RISK`/`AUTO_ELIGIBLE` is an immediate FAIL.

## 2. Natural arm: sequential, representative, and feasible

There is no artificial Stage 1.  After the independent custodian has sealed a new replacement holdout and committed an opaque membership hash and deterministic order hash, review proceeds sequentially through that order.  No sampling, stratification, reordering, or stopping may use identity, content, human label, verifier route, or predicted severity.

Stop the natural arm when either (a) both 20 human-CLEAN and 20 human-MINOR labels have accrued, or (b) 100 natural packets have been completed, or (c) an immediate FAIL/TECHNICAL_ABORT occurs.  The 100-packet cap is a burden cap, not an estimate of a future population.  The prior authoritative human cohort's 21/85 clean fraction is used only as a planning sensitivity: under an iid binomial approximation it gives 24.7 expected CLEAN labels in 100, about 0.888 probability of at least 20 CLEAN labels, and an expected 81 packets to reach 20 CLEAN labels.  It is not asserted to be a prospective prevalence estimate.

The fixed natural thresholds are **operational gates**, not inferential confidence requirements and not claims of high-confidence population performance.  They are reported with exact observed numerator/denominator and no confidence interval is used to declare PASS:

- **Minor routing gate:** among at least 20 natural human-MINOR packets, at most 2 may route `LOW_RISK` / `AUTO_ELIGIBLE`.  More than 2 is FAIL; fewer than 20 by packet 100 is INCONCLUSIVE for this target.
- **Clean burden gate:** among at least 20 natural human-CLEAN packets, at most 2 may route `HIGH_RISK` / human-review.  More than 2 is FAIL; fewer than 20 by packet 100 is INCONCLUSIVE for this target.

The observed 18/20 routing proportion implied by either boundary is descriptive only.  No binomial confidence statement, zero-count bound, or generalized “90% performance” claim is made.

## 3. Severe challenge coverage suite

The suite has 12 qualifying cases: four in each of (1) material contradiction or identity/role substitution; (2) unsupported causal/motive/mechanism or setting/quantity concretization; and (3) spoiler/reveal or consequence leakage.  These are ordinary, plausible editorial-copy failures, not injection strings or information the production verifier would not receive.

Before any natural item is opened, a custodian freezes a finite non-holdout source-packet pool, its exclusion proof, a deterministic packet order, and six attempted constructions per class (18 total maximum).  The construction author, who is not a challenge adjudicator, receives only an eligible frozen source packet and the class-level transformation specification.  Each attempted candidate is independently labeled by two distinct challenge adjudicators, both blind to construction instructions and verifier output.  A candidate qualifies only if **both initial adjudicators label it SEVERE**.  Any disagreement or non-SEVERE label permanently disqualifies that attempted candidate; it may be retained only as a diagnostic record and no third reviewer may convert it into a qualifying case.

For each class, choose the first four qualifying cases in the frozen attempted-construction order.  Do not construct replacements beyond the six preregistered attempts per class, select by apparent obviousness, inspect verifier outputs during selection, or move cases across classes.  If any class has fewer than four qualifying candidates, the severe challenge target is INCONCLUSIVE and the prospective verifier run does not begin.  Challenge packets must be absent from development, retrospective, natural-holdout, and production cohorts.  The verifier receives normal packet/copy only, never the class, construction record, or human labels.

A severe challenge escape is a qualifying challenge case routed `LOW_RISK` / `AUTO_ELIGIBLE`.  Zero escapes across all 12 qualifying cases is required for the coverage-suite gate; one is immediate FAIL.  This is a deterministic coverage assertion, not an estimator or inferential confidence requirement.

## 4. Human independence, blinding, and QA

The minimum distinct people required before execution are eight: (1) independent holdout/challenge custodian; (2) challenge construction author; (3) challenge adjudicator A; (4) challenge adjudicator B; (5) natural-arm primary adjudicator; (6) natural-arm QA adjudicator; (7) a predesignated natural-label reconciliation adjudicator; and (8) verifier operator.  These are distinct people; repeated sessions by one person do not satisfy independence.  The custodian and verifier operator must not adjudicate; the construction author must not challenge-adjudicate.  Resource availability is an unresolved pre-execution prerequisite.

The natural primary sees only the blind verifier input packet and `A_PRIME_PRODUCTION_MATERIALITY_V1`.  They cannot see verifier output, route, quotas, counts, prior labels, repairs, challenge construction, or outcome state.  No model adviser is used as human ground truth.  Every natural human-SEVERE label and every verifier/natural-human disagreement receives a blind second-human review.  Additionally, select `ceil(25% of remaining agreements)` by ascending `SHA256(qaSeed || "\n" || packetHash)`.  The QA reviewer sees no primary label or verifier output.  A human-label disagreement triggers a versioned reconciliation by a separately assigned governance panel; it is a required additional resource if any disagreement arises, is blind to verifier output, and never silently overwrites either record.  It does not affect challenge-suite qualification.

Challenge qualification already has two independent blinded human labels on every case; no third-human adjudication is used to rescue ambiguity.  Natural adjudicator drift is monitored by the custodian only after blinded blocks of 10 using QA consistency records; no running rates, labels, quotas, or pass/fail state are disclosed to adjudicators.

## 5. Frozen intervention, input contract, and firewall

The v1.4 paired-development protocol commits the v1.4 intervention to Google Gemini Developer API, `gemini-3.8-flash`, `thinkingLevel=low`, temperature 0, maximum output tokens 6144, timeout 30000 ms, no few-shot examples, and zero automatic retries.  A separate committed retrospective replay runner specifies medium thinking and retries, so it is not treated as authority for this prospective intervention.  Accordingly, r2 preregisters the low/zero-retry configuration as a prospective decision aligned with the v1.4 paired intervention.  It is not a claim that a prior prospective execution fixed it.  The provider-returned model/version string must be logged and must remain constant; absence or mutation is TECHNICAL_ABORT.

No standalone v1.4 input-schema artifact exists.  The input contract is jointly defined by: the seven-surface builder in `scaleTranche1Plan.mjs`; the seven-surface allowlist and leakage denial-list in `runVerifierV13RetrospectiveReplay.mjs`; and the blind-packet schema that validates the human-facing superset and visible copy.  These exact files and hashes are bound in the manifest.  The verifier input has exactly `facts`, `acceptedSemanticClassification`, `semanticBoundaryFlags`, `allowedSourceMaterial`, `spoilerBoundaryRules`, `copyConstraints`, and `visibleEditorialCopy`; optional `deterministicLintFindings`, if present, must be bound in the future input-contract freeze and be identical across applicable packets.

Before any packet is opened, a separate signed execution-freeze record must bind the r2 protocol and manifest hashes; prompt, output schema and validator, materiality policy, all input-contract artifacts, routing rule, model configuration, malformed-output behavior, replacement-holdout membership/order commitments, QA seed, challenge manifest, analysis script, and operator log schema.  Every packet is one-way supplied to the verifier; no human label or prior-candidate judgment enters a later prompt.  The human system hides verifier output/routes until the human decision is committed.  No prompt tuning, configuration substitution, retry, or adaptive threshold change is permitted.

Malformed, schema-invalid, missing, duplicate, candidate-mismatched, or unlogged output is never semantic success and is a TECHNICAL_ABORT.  Any holdout access before freeze, hash/order mismatch, route/label leakage, packet skip/reordering, frozen-input mutation, or provider-model mutation is also TECHNICAL_ABORT.

## 6. Outcomes and resource analysis

`PASS` requires zero coverage-suite escapes, no natural severe escape, both natural operational gates, zero technical defect, and full integrity compliance.  `FAIL` is any severe escape or completion of a natural denominator with more than two errors at its respective gate.  `INCONCLUSIVE` is an intact run that cannot qualify all 12 challenges within 18 attempts, cannot reach a natural denominator by 100 packets, or exhausts its sealed pool.  `TECHNICAL_ABORT` invalidates the run; restarting requires a new protocol and freeze.

Planning burden is conditional, not a prediction: at the retrospective clean-rate sensitivity point, natural review stops near 81 labels if no earlier outcome occurs.  With no verifier/human disagreements, its QA floor is `ceil(0.25 × 81)=21`; disagreement increases QA by 0.75 label per disagreement, up to 81, and every primary/QA label disagreement adds one reconciliation label.  The challenge planning minimum is 12 attempted/qualifying cases and 24 challenge labels; the hard cap is 18 attempts and 36 challenge labels.  Thus an optimistic planning scenario is about 126 labels (81 natural primary + 21 natural QA + 24 challenge), while the hard maximum is 336 labels (100 natural primary + 100 natural QA + 100 reconciliations + 36 challenge).  There is no evidence basis for a point estimate of disagreement, so none is asserted.  Maximum verifier calls are 112 (100 natural + 12 qualifying challenge cases); nonqualifying attempted challenges are never sent to the verifier.

## 7. Holdout provenance and non-authorizations

The committed `legacy-prospective-holdout-retirement.v1.json` records `LEGACY_PROSPECTIVE_HOLDOUT_IDENTITY_CONFIDENTIALITY_COMPROMISED`, prohibits future prospective reuse, and says semantic copy and labels were not disclosed.  Its hash is bound in the manifest.  r2 neither opens nor enumerates that retired holdout or any replacement holdout.

This protocol does not construct challenge cases, run a verifier, acquire labels, modify runtime catalogues, repair candidates, start SCALE_TRANCHE_2, commit, or push.
