# Source-Boundary Risk Verifier v1.4 — Prospective Semantic Validation

- **Protocol ID:** `source-boundary-risk-verifier.v1.4-prospective-validation.r1`
- **Status:** `PREREGISTERED_DESIGN_ONLY_NOT_AUTHORIZED_TO_EXECUTE`
- **Governance consequence of a PASS:** evidence for a subsequent, separate production-authorization decision only; never automatic promotion.

## 1. Purpose and design decision

This protocol evaluates the frozen v1.4 verifier on future, previously uninspected candidate packets.  It has five distinct targets: (1) containment of human-confirmed severe source-boundary defects; (2) routing of human-MINOR defects to review; (3) the unnecessary-review burden imposed on human-CLEAN records; (4) technical/schema validity; and (5) leakage and execution integrity.  The unit is one immutable candidate packet containing its authorized source material and four visible editorial fields, plus one independent human label and one verifier result.

The recommended design is **B, a two-arm validation**: a sealed, representative natural arm plus a separately frozen severe-enriched challenge arm.  The historical evidence contains 0 SEVERE labels in 184 reviewed records.  Thus, requiring six naturally occurring severe cases in a sealed representative stream makes design A's severe conclusion depend primarily on a rare-event stopping failure, not verifier safety.  It could consume the entire holdout and still be inconclusive without testing severe containment.  A two-arm design retains a natural-distribution estimate for minor routing and clean burden, while directly testing severe containment on source-boundary-realistic severe cases.  No combined generic accuracy statistic is used.

The simpler alternative, a natural arm only with no severe target, is rejected because it cannot establish severe containment.  The historical six-natural-SEVERE rule is therefore not copied.

| Design | Human primary burden | Model calls | Severe containment | Main limitation |
| --- | ---: | ---: | --- | --- |
| A: natural only | up to exhaustion; six severe may never occur | one per reviewed item | conditional on rare natural cases | inefficient and may be permanently inconclusive |
| **B: recommended** | 42–72 primary labels | 42–72 | 12 deliberately source-realistic severe cases | enriched arm does not estimate prevalence |
| Natural only, no severe target | 30–60 primary labels | 30–60 | none | misses the governance-critical property |

## 2. Arms, sampling, and burden

**Natural arm.** A newly sealed replacement holdout (the legacy holdout is retired and must not be reused) is sampled in a deterministic random order without stratification by identity, content, predicted route, or label.  Stage 1 is the first 30 packets.  Continue once, with the next 30 packets (maximum 60 natural packets), only when Stage 1 has no immediate failure or technical abort and has fewer than 20 human-CLEAN labels or fewer than 20 human-MINOR labels.  Do not extend beyond 60.  A natural-arm PASS requires at least 20 CLEAN and 20 MINOR labels among reviewed valid packets; otherwise it is INCONCLUSIVE for that target.  Natural human-SEVERE cases are reported separately and never used to select or substitute challenge cases.

**Severe challenge arm.** Before opening any natural packet, a separate, non-holdout source-packet pool is sealed.  Twelve cases are created, four each from: (a) material contradiction or identity/role substitution; (b) unsupported causal, motive, mechanism, or setting/quantity concretization; and (c) spoiler/reveal or consequence leakage.  They must use source packets absent from every development, retrospective, natural-holdout, and production cohort; packet provenance and exclusions are mechanically checked.  A construction author receives only the frozen source packet and a class-level transformation specification and creates one ordinary editorial candidate; it must be plausible production copy, not a prompt injection, a conspicuous test string, or information unavailable to the production verifier.  The tested verifier receives only the normal packet and copy, never a transformation class or label.

Two independent humans, neither the construction author nor primary natural reviewer, adjudicate each challenge packet blind to its construction instruction and to verifier output.  Only unanimous SEVERE labels become challenge cases; disagreement is resolved by a third independent human, also blind to construction and verifier output.  The resolution label and packet hash are frozen before the verifier run.  If fewer than 12 qualifying cases can be created without breaking these rules, no substitution is permitted and severe containment is INCONCLUSIVE.  Enriched/synthetic cases test specified failure-class containment, not their natural prevalence or all possible severe modes.

The natural arm has at most 60 primary-human labels.  The challenge arm requires 24 independent source-of-truth labels, plus at most 12 third-human reconciliations.  Natural-arm second-human QA is at most 60 labels (if every natural result disagrees with the verifier); its severe and deterministic-agreement obligations are subsets of that cap.  Thus the conservative maximum is **156 human labels** (60 natural primary + 60 natural QA + 36 challenge-source-truth/reconciliation labels), with 72 verifier calls.  Challenge cases are already double-human adjudicated, so that independent source-truth review satisfies their disagreement-QA requirement.  No model is ground truth.

## 3. Human labeling and QA

The primary label is authoritative for the natural arm.  The primary adjudicator sees only the immutable blind packet, the `A_PRIME_PRODUCTION_MATERIALITY_V1` rubric, and a packet identifier with no route meaning.  They do not see verifier output, risk level, prior judgments, repair history, challenge construction, quotas, running counts, holdout membership, or pass/fail state.  Model advisers are omitted: they add no necessary evidence and would dilute independent human judgment.

Every natural human-SEVERE label and every verifier/human disagreement is second-human QAed.  In addition, a deterministic 25% sample of remaining verifier/human agreements is selected by ascending `SHA256(qaSeed || "\n" || packetHash)`, rounded up.  The second reviewer sees the same blind packet and rubric, but no primary label, verifier output, route, quota, or construction material.  Any disagreement is resolved by a third human blinded to both prior labels and verifier output; the adjudication panel records a versioned reconciliation, never silently overwrites a label.  The reconciled human label governs analysis.  Drift is monitored after each blinded block of 10 by an independent coordinator using precommitted rubric-consistency checks on the QA records only; no labels, quotas, or outcome summary is fed back to either adjudicator during the run.

## 4. Frozen intervention and firewall

Before the first prospective packet is opened, an execution-freeze record must bind the values and hashes named in `protocol-manifest.v1.json`: verifier prompt, input schema, output schema and validator, source-boundary/materiality policy, Google Gemini Developer API model `gemini-3.8-flash`, `thinkingLevel=low`, temperature `0.0`, maximum output tokens `6144`, timeout `30000 ms`, zero automatic retries, malformed-output rule, and routing rule (`LOW_RISK` => auto-eligible candidate route; `HIGH_RISK` or invalid => human-review route).  The provider-returned exact model/version string is logged for every call; an unavailable or changed string is a TECHNICAL_ABORT.  There is no model/configuration substitution, prompt tuning, retry, or threshold modification after execution begins.

The freeze also must bind a new holdout membership hash without listing identities or content, the deterministic order-generation method and resulting order hash, QA seed, challenge cohort manifest hash, analysis-script hash, and hashes of this protocol and manifest.  These values are intentionally unresolved in this design-only artifact because obtaining them now would require prohibited holdout access.  A custodian who is not an adjudicator or verifier operator performs future sealing and writes only opaque commitments.  This protocol author did not read the prospective-holdout file.

The executor gives the verifier only one packet at a time and gives it no human labels or prior-candidate data.  The human interface cannot query or display verifier output/routing until a human label is committed.  Separate append-only ledgers, least-privilege directories, content hashes, and a preflight refusal on hash/order/schema mismatch enforce this.  Invalid output is recorded as invalid, routes to review operationally, and cannot be reclassified as a semantic success; no retry can silently change the intervention.  Any holdout read before the signed freeze, leaked label/route, reordered/skipped packet, prompt/configuration mutation, or failed hash binding is a TECHNICAL_ABORT.

## 5. Outcomes and fixed decision rules

All denominators are reported separately by arm and label; invalid calls stay in the technical denominator and never become semantic true negatives.

- **Severe containment:** a severe escape is a QA-confirmed human-SEVERE packet routed `LOW_RISK` / `AUTO_ELIGIBLE`.  Zero severe escapes among all 12 independently confirmed challenge cases is required.  One is immediate FAIL.  Natural severe escapes, if any, are also immediate FAIL.
- **Minor routing:** among at least 20 natural human-MINOR packets, at most 2 may be `LOW_RISK` / `AUTO_ELIGIBLE` (at least 90% routed to review).  More than 2 is FAIL; an insufficient denominator after Stage 2 is INCONCLUSIVE.
- **Clean false-positive burden:** among at least 20 natural human-CLEAN packets, at most 2 may be `HIGH_RISK` / human-review routed (at least 90% not unnecessarily routed).  More than 2 is FAIL; an insufficient denominator after Stage 2 is INCONCLUSIVE.
- **Technical/schema validity:** zero malformed, schema-invalid, missing, duplicated, candidate-mismatched, or unlogged outputs across completed calls.  Any such event is TECHNICAL_ABORT.
- **Integrity:** any hash, order, leakage, unauthorized access, or frozen-input failure is TECHNICAL_ABORT.

`PASS` requires all three semantic criteria, complete technical validity, and integrity compliance.  `FAIL` is an immediate severe escape or a completed natural arm that exceeds either fixed minor or clean tolerance.  `INCONCLUSIVE` is a valid, intact run that cannot reach a required natural denominator by 60 packets, cannot construct 12 independently confirmed challenge cases, or exhausts a sealed natural pool before the applicable stage; it does not authorize promotion.  `TECHNICAL_ABORT` invalidates the run and requires a new protocol/freeze before any restart.  The absence of natural severe labels is reported as expectedly uninformative for severe containment; it neither passes nor fails that target because the challenge arm governs it.

## 6. Preconditions and non-authorizations

The legacy prospective holdout is retired because its identity confidentiality was compromised.  A new, independently sealed replacement holdout and its opaque membership commitment are mandatory before execution.  This artifact neither opens nor enumerates any holdout, creates challenge examples, runs the verifier, acquires labels, changes runtime catalogues, starts SCALE_TRANCHE_2, repairs candidates, commits, or pushes.
