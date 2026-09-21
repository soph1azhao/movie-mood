# Source-Boundary Risk Verifier v1.4 — Prospective Semantic Validation r2.1

- **Protocol ID:** `source-boundary-risk-verifier.v1.4-prospective-validation.r2.1`
- **Status:** `PREREGISTERED_DESIGN_ONLY_AWAITING_EXECUTION_FREEZE`
- **Amends:** r2's natural-gate semantics, burden accounting, and execution clarity.  r1 and r2 remain immutable pre-execution evidence.

## 1. Natural arm: terminal realized-denominator governance gates

The natural arm uses the r2 frozen representative sequential order.  It ends at the first point at which both `humanCleanCount >= 20` and `humanMinorCount >= 20`, or after 100 **valid** natural packets, unless an immediate FAIL or TECHNICAL_ABORT occurs first.  Counts are final human labels after required QA/reconciliation.  A QA-confirmed human-SEVERE packet routed `LOW_RISK` / `AUTO_ELIGIBLE` is an immediate FAIL.  A technical or integrity violation is an immediate TECHNICAL_ABORT.

At this terminal natural-arm point only, apply these realized-denominator operational governance gates:

- `minorLowRiskCount / humanMinorCount <= 0.10`, where `humanMinorCount >= 20`; equivalently, `minorLowRiskCount <= floor(0.10 * humanMinorCount)`.
- `cleanHighRiskCount / humanCleanCount <= 0.10`, where `humanCleanCount >= 20`; equivalently, `cleanHighRiskCount <= floor(0.10 * humanCleanCount)`.

Thus maximum permitted errors are 2 at denominators 20–29, 3 at 30, 6 at 60, and 8 at 80.  These are operational governance gates, not confidence intervals, population-performance estimates, or claims that an error probability is at most 10% at any confidence level.  Provisional CLEAN/MINOR gate results neither stop the arm nor are shown to adjudicators.  If packet 100 is reached with either denominator below 20, that target is INCONCLUSIVE.

## 2. Challenge suite and pre-natural sequencing

The severe challenge coverage suite retains three failure classes, six attempted constructions per class, and four qualifying cases per class.  Before **any** natural holdout packet is opened, the custodian must: (1) freeze the challenge source pool, exclusion proof, deterministic attempt order, and transformation specification; (2) freeze all 18 attempted constructions; (3) obtain two independent blind human labels for every attempt; (4) resolve qualification mechanically; and (5) freeze the 12 qualifying case hashes and suite manifest.

An attempt qualifies only when **both initial challenge adjudicators label it SEVERE**.  A disagreement or non-SEVERE label is permanently disqualified.  There is no third-human rescue, no replacement beyond the six frozen attempts per class, and no selection based on apparent obviousness or verifier output.  Select the first four qualifying attempts per class in the frozen order.  If any class supplies fewer than four, the outcome is INCONCLUSIVE and the natural arm must not begin.

The challenge transformation specification describes failure classes, not answer templates or conspicuous wording recipes; contains no labels or verifier outputs; is frozen and hashed before construction; and cannot change after construction begins.  The append-only challenge provenance record retains all 18 attempts with only governed status/provenance needed for audit.  Nonqualifying attempts are not deleted, substituted, or sent to the tested verifier; they remain access-controlled diagnostic evidence and cannot influence construction in the same frozen run.

After qualification succeeds, the execution-freeze record binds the fixed inter-arm verifier order: qualifying challenges in frozen suite order, then natural packets in frozen natural order.  A qualifying challenge SEVERE routed `LOW_RISK` / `AUTO_ELIGIBLE` is an immediate FAIL and terminates the run before natural processing.  The operator has no discretion to alter this sequence.

## 3. Human roles, information boundaries, and burden

Execution requires eight confirmed distinct people: (1) independent custodian; (2) challenge construction author; (3) challenge adjudicator A; (4) challenge adjudicator B; (5) natural primary adjudicator; (6) natural QA adjudicator; (7) one predesignated natural reconciliation adjudicator; and (8) verifier operator.  If all eight are not confirmed before freeze, execution is not authorized.

The following separations are mandatory: custodian != verifier operator; construction author != either challenge adjudicator; natural primary != natural QA; natural reconciliation != natural primary or QA; verifier operator must not adjudicate; and custodian must not adjudicate.  One reconciliation adjudicator, not a plural panel, resolves a natural primary/QA human-label disagreement without seeing verifier output.

The custodian may receive only the minimum aggregate final human-label counts needed to apply the stopping rule.  The custodian receives no verifier outputs, verifier error counts, provisional CLEAN/MINOR gate results, production routes, or adjudicator rationales beyond mechanically necessary status.  The custodian must never communicate running counts or stopping state to natural adjudicators.

All 18 attempted challenge constructions receive two independent human labels: challenge labeling burden is therefore exactly 36 actions, not 24.  Under the r2 planning sensitivity, an optimistic scenario is approximately 138 labeling actions: 81 natural primary + 21 natural QA floor + 36 challenge labels.  It is a planning scenario conditional on the historical clean-rate sensitivity and no natural primary/QA disagreements, not an expected value.  The hard maximum remains 336: 100 natural primary + 100 natural QA + 100 natural reconciliations + 36 challenge labels.  People and labeling actions are distinct quantities.

## 4. Frozen intervention, runtime dependencies, and model limitation

The intervention remains Google Gemini Developer API, `gemini-3.8-flash`, `thinkingLevel=low`, temperature 0, maximum output tokens 6144, timeout 30000 ms, and zero automatic retries.  The provider-returned model/version identifier is logged for every call; absence or mutation is TECHNICAL_ABORT.  If the provider supplies only a stable alias rather than a version-distinguishing identifier, provider-side changes behind that alias may be undetectable.  This is an inherent reproducibility limitation.  Temperature 0 does not claim API-level determinism.

The r2 joint input contract remains in force.  Before execution, the freeze must bind a complete runtime dependency declaration for the verifier-input builder, including every file, configuration, and environment-derived value capable of altering the verifier-visible semantic payload.  `deterministicLintFindings` must be either universally absent or explicitly bound and frozen.  Any unbound runtime dependency capable of changing semantic input causes the execution freeze to fail closed.

The freeze also binds the prompt, output schema and validator, materiality policy, input-contract artifacts, routing/malformed-output rules, replacement-holdout commitments, QA seed, challenge source/exclusion and attempted-construction manifests, transformation-specification hash, qualifying-suite hash, analysis-script hash, operator-log schema hash, and r2.1 hashes.  No prompt tuning, model/configuration substitution, retry, threshold adjustment, prior-label injection, or label/route disclosure is allowed.

## 5. Outcomes

`PASS` requires zero qualifying-challenge escapes, no natural severe escape, both terminal natural rate gates, full technical validity, and integrity compliance.  It is evidence only for a later governance decision, never automatic production authorization.

`FAIL` is immediate for a QA-confirmed natural human-SEVERE escape or qualifying challenge-SEVERE escape.  It is a terminal natural-gate FAIL only when the terminal realized MINOR low-risk rate or CLEAN high-risk rate exceeds 0.10.

`INCONCLUSIVE` applies to an intact run with insufficient qualifying challenges before natural access, or either natural denominator below 20 at 100 valid natural packets.

Any `TECHNICAL_ABORT` invalidates the entire prospective run, regardless of earlier counts or an otherwise passing arm.  Earlier evidence may be retained diagnostically but cannot support PASS.  Restart requires a new authorized execution freeze under the then-applicable governance.

This is design only: no holdout is opened or enumerated, no challenge case is constructed, no verifier call or human label is acquired, and no runtime catalogue is changed.
