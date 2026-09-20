# Verifier v1.4 Final Synthesis and Governance Disposition

## Executive disposition

**Recommended governance state:** `ELIGIBLE_TO_PREREGISTER_PROSPECTIVE_SEMANTIC_VALIDATION`.

V1.4 has completed a retrospective remediation and evidence-closure exercise. It establishes that the source-boundary policy can be applied with explicit, fail-closed judgments and that the historical continuation defect was detected and contained. It does not authorize production promotion. Before a tranche may rely on v1.4, a new prospective semantic validation must be preregistered and run against the sealed holdout without changing its isolation status.

This uses the advancement term already defined by the frozen v1.4 protocol. It replaces `PAUSED_FOR_SEVERE_AUDIT_MISS` only for the limited purpose of preparing prospective validation; it does not clear production governance or authorize a production tranche.

## Evidence classes and provenance

| Evidence class | Candidates | Authority | Final result |
| --- | ---: | --- | --- |
| Original review | #1–#85 | Authoritative human adjudications by the named primary adjudicator under `A_PRIME_PRODUCTION_MATERIALITY_V1` | 21 APPROVE; 64 REVISE/MINOR; 0 SEVERE |
| Codex-assisted continuation | #86–#184 | Retrospective-development evidence only; explicitly not human ground truth | 48 APPROVE; 51 REVISE/MINOR; 0 SEVERE |

The continuation is designated `VERIFIER_V1_4_CODEX_ASSISTED_CONTINUATION`. The amendment records why the original human sequence stopped at #85 and why the remaining frozen pool was completed under a different evidence class. The two rows must remain separate in analysis, reporting, and any later model evaluation. No pooled human-accuracy statistic across all 184 candidates is valid.

The final continuation is [adjudications-86-184.final.v1.jsonl](codex-assisted-continuation/adjudications-86-184.final.v1.jsonl), SHA-256 `55a5626d921c54d44bd2f088a206b622f162b5a8f653c23f3224b5ac0726f3e9`. Its reconciliation and manifest bind the historical passes and final mechanics.

## Human-ground-truth findings (#1–#85)

The persisted human records reproduce cleanly: 85 total, 21 APPROVE, 64 REVISE/MINOR, and zero REVISE/SEVERE. These labels are the only v1.4 candidate decisions that constitute human ground truth.

The high rate of bounded MINOR intervention shows that the recurring problem was not broad failure to recognize tone, genre, or viewing-experience language. The problem was concrete source-boundary drift inside otherwise plausible editorial writing. The calibrated policy tolerated non-material compression, rhetorical intensity, atmosphere, and genre shorthand. It intervened where a phrase changed what a viewer could reasonably infer about the story.

## Codex-assisted continuation findings (#86–#184)

The final continuation contains 99 explicit records: 48 APPROVE, 51 REVISE/MINOR, and zero REVISE/SEVERE. It is useful as retrospective diagnostic and remediation evidence, including for patterns that the initial continuation missed. It is not a substitute for a new human-ground-truth cohort.

Pass 1 had 76 APPROVEs, but its implementation could emit APPROVE when a record lacked an override. The independent Pass-2 audit reviewed every Pass-1 APPROVE and found 27 disagreements. Final reconciliation accepted 24 of those revisions, reverted three as non-material under the calibrated threshold, and added four bounded revisions missed by Pass 2. This is evidence of a material execution-integrity defect in the first continuation pass, not evidence that every original APPROVE was independently reviewed.

## Cross-cutting failure taxonomy

Across both classes, the dominant observed failures were bounded concretizations in these categories:

- Setting and geographic scope: converting production geography into story setting, naming an unsupported micro-location, or expanding a local premise into globe-spanning travel.
- Identity, ontology, role, and trait: turning an unspecified presence into a ghost, assigning an occupation or role, or narrowing a character or entity type.
- Causality, motive, mechanism, status, and threat: supplying an intent, causal mechanism, disease mechanism, procedural stage, or changed knowledge state that the packet did not establish.
- Agency and procedure: asserting voluntary participation, an assignment, an investigation role, or a purposeful design relation beyond the overview.
- Production or formal claims: inferring a filmmaking format from story-world content or metadata.

These are failure modes of source-boundary control, not ordinary prose quality. They also confirm two operational rules: genre cannot supply plot mechanics, and visible metadata or `facts.keywords` cannot authorize semantic editorial facts when `allowedSourceMaterial.keywords` is empty.

## Interpretation of zero observed SEVERE cases

No final human or Codex-assisted record was labeled SEVERE. This shows that no reviewed record was adjudicated as a severe distortion under this retrospective protocol and calibration. It does not establish that severe risk is zero, that v1.4 catches all severe defects, or that a production route has no severe-audit-miss risk.

The original design required at least six severe cases because severe-escape safety cannot be inferred from a cohort with none. That threshold was never met before the human sequence was amended. The absence of observed SEVERE cases is therefore a descriptive result and a feasibility limitation, not a safety pass.

## What v1.4 establishes

1. The retrospective record has a stable, provenance-preserving distinction between 85 human decisions and 99 Codex-assisted decisions.
2. The materiality policy consistently separates non-material editorial inference from decision-relevant factual concretization.
3. The prevalent defects are local and repairable: they identify fields and claims rather than requiring wholesale editorial regeneration.
4. The unsafe continuation behavior was remediated mechanically. The final validator requires exactly one explicit judgment for every sequence 86–184 and fails on missing, duplicate, unexpected, or candidate-mismatched records.
5. The resulting evidence is sufficient to preregister a new prospective semantic validation with a narrower, more efficient human workflow.

## What v1.4 does not establish

1. It is retrospective development evidence, not prospective validation, production validation, or promotion authorization.
2. The workflow changed after #85; the continuation is not human ground truth and must not be represented as such.
3. The sealed prospective holdout remains unexamined by this synthesis and has not supplied an independent generalization result.
4. Zero observed SEVERE cases does not demonstrate zero severe risk or meet the original six-severe safety requirement.
5. Model-assisted continuation introduces uncertainty about independent semantic judgment even after the final reconciliation; it cannot replace blinded human labels for a prospective evaluation.
6. The study evaluates a bundled v1.4 instruction set under its registered conditions. It cannot attribute a result to a single prompt rule or establish performance at another model/thinking configuration.

## Execution-integrity lessons

### Pass-1 fail-open defect

Pass 1 preserved existing results, applied selected overrides, then defaulted all remaining records to APPROVE. A complete JSONL and valid hash therefore did not prove that every APPROVE received an independent judgment. The pass remains immutable historical evidence and must never be treated as the canonical continuation result.

### Independent Pass-2 audit

Pass 2 used Pass 1 only to identify the APPROVE set, then reviewed those packets against the frozen materiality policy. Its 27 disagreements demonstrated why a mechanical completion check is insufficient for semantic assurance.

### Fail-closed finalization

The final canonical JSONL is produced from explicit records. `verifierV14ContinuationValidation.mjs` rejects a missing judgment, duplicate sequence, unexpected sequence, candidate-ID mismatch, invalid decision shape, or invalid severity. Its focused regression test proves that a missing candidate throws instead of becoming APPROVE.

## Governance disposition

The original `PAUSED_FOR_SEVERE_AUDIT_MISS` is resolved only at the retrospective remediation level: the failure mechanism has been documented, the contaminated fail-open continuation is preserved rather than hidden, and the canonical continuation is fail-closed. That is enough to allow preregistration of prospective validation.

It is not enough to authorize that validation without a new freeze, and it is not enough to authorize production promotion. The active V8.2 governance remains risk-based human review and adaptive audit: model output alone never promotes a record, and a severe audited miss pauses the affected tranche and triggers diagnosis.

## Prospective validation recommendation

Run a small two-stage, human-labeled prospective study using only the sealed holdout after a separate authorization and freeze. The unit is one frozen candidate packet plus its four visible editorial fields. A primary human adjudicator reviews the packet under `A_PRIME_PRODUCTION_MATERIALITY_V1` while blinded to verifier output, risk routing, prior labels, quotas, and repair history; a second human performs QA on every human-SEVERE label, every verifier/human disagreement, and a deterministic 25% sample of the remaining labels. Multiple model advisers are unnecessary for this validation because the target is verifier performance against frozen human labels; they add cost and can complicate provenance. Freeze the candidate prompt, schema, validator, materiality policy, holdout membership hash, deterministic review order and QA seed, request configuration, output-routing rule, and analysis plan before any holdout item is opened.

Stage 1 should review 30 candidates in the frozen deterministic order and stop immediately on any human-SEVERE defect that v1.4 routes LOW_RISK or AUTO_ELIGIBLE. It may pass to Stage 2 only if technical validity is complete, no severe escape occurs, and no more than two human-MINOR interventions were routed LOW_RISK; otherwise halt for diagnosis. If Stage 1 contains no human-SEVERE labels, it cannot establish severe containment and must expand sequentially. Stage 2 continues only until the preregistered evidence target is met: at least 30 clean and 30 defect-positive labels with at least six QA-confirmed SEVERE labels, or exhaustion of the sealed pool. Any severe escape, model/version mutation, packet or hash mismatch, invalid output, leakage, reordering, skipped candidate, or unmet severe target is an abort or inconclusive outcome, never an approval. Promotion remains gated on the resulting validation, production-contract checks, risk routing, required human review, adaptive audit, and explicit production authorization.

## Implications for current SCALE_TRANCHE_1 candidates

The current eligible SCALE_TRANCHE_1 production-assembly cohort (`production-assembly.v1.1.json`) comprises exactly 99 candidates (76 `RISK_BASED_AUTO_ELIGIBLE` and 23 `HUMAN_APPROVED` records, plus one deferred provider failure `exp100-tmdb-1156593`). Joining this production cohort against both the canonical Codex continuation (#86–#184) and the authoritative human review sequence (#1–#85) establishes the complete 99-candidate evidence partition, documented in [v1-4-scale-tranche-1-semantic-impact.v1.json](v1-4-scale-tranche-1-semantic-impact.v1.json) and [v1-4-scale-tranche-1-impact-map.v1.json](v1-4-scale-tranche-1-impact-map.v1.json):

1. **Codex-continuation-covered SCALE_TRANCHE_1 candidates (42 records):**
   - **Continuation APPROVE (24 candidates):** Require no semantic repair from this retrospective review; however, this is not production authorization and active V8.2 risk routing, adaptive audit, production-contract, and promotion gates remain applicable.
   - **Continuation REVISE/MINOR (18 candidates):** Require bounded targeted field-level repair against their original authorized packets and fresh source-boundary revalidation before attaining semantic promotion eligibility.
   - **Continuation SEVERE (0 candidates):** Zero severe defects observed.

2. **Authoritative human-v1.4-covered SCALE_TRANCHE_1 candidates (34 records):**
   - **Human v1.4 APPROVE (7 candidates):** Require no semantic repair under this review; normal production gates remain.
   - **Human v1.4 REVISE/MINOR (27 candidates):** Adjudicated as minor source-boundary overreach under human ground truth (`A_PRIME_PRODUCTION_MATERIALITY_V1`); require bounded targeted repair and fresh source-boundary revalidation before semantic promotion eligibility.
   - **Human v1.4 SEVERE (0 candidates):** Zero severe defects observed under human adjudication.

3. **Pre-existing HUMAN_APPROVED candidates outside v1.4 (23 records):**
   - These 23 candidates were editorially cleared by human review prior to palette assembly (`human-review-decisions.completed.v1.json`) and were not sampled into the retrospective v1.4 auto-eligible review pool.
   - Nothing is inferred from v1.4 for these candidates; they retain their existing production human-review provenance and remain subject to active V8.2 production gates.

**Synthesis of repair requirements:**
Across the entire 99-member SCALE_TRANCHE_1 production cohort, exactly **45 candidates** require targeted semantic repair as a direct implication of retrospective v1.4 evidence (18 continuation MINORs + 27 human v1.4 MINORs). Exactly **31 candidates** are clean under v1.4 evidence (24 continuation APPROVEs + 7 human v1.4 APPROVEs), and **23 candidates** are governed by pre-existing production human approvals. Exactly **0 candidates** exhibit severe distortions across either v1.4 evidence source.

Existing targeted-repair machinery is appropriate for the 45 MINOR candidates because findings identify localized claims and affected fields. Any repair must preserve the packet boundary, prohibit new facts, and quarantine any repair that remains unresolved or fails deterministic/semantic validation. Nothing in V1.4 authorizes applying those repairs now.

## Required next actions

1. Keep all v1.4 human, Pass-1, Pass-2, reconciliation, and final artifacts immutable.
2. Prepare and approve a separate prospective-validation preregistration and freeze without opening the holdout during preparation.
3. Execute the prospective validation only under that frozen protocol and its leakage controls.
4. If it passes, evaluate the resulting production eligibility through the existing V8.2 risk-routing, targeted-repair, audit, and promotion-authorization contracts.

## Explicit non-authorizations

This disposition does not authorize prospective-holdout access, semantic repair, editorial regeneration, catalogue generation, runtime-catalogue writes, SCALE_TRANCHE_2, production promotion, commit, push, tag, deployment, or release.
