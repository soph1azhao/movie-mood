import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serializeArtifactForPersistence } from './validatePromotionContract.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const p2Dir = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development')
const generatorPath = fileURLToPath(import.meta.url)

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relPath), 'utf8'))
}

function sha256(buf) {
  return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex')
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

export async function buildP21Artifacts(options = {}) {
  const {
    outputDir = p2Dir,
    simulatePrerequisiteFailure = false,
  } = options

  console.log('Building Candidate Verifier v1.4 P2.1 Governed Artifacts (Fail-Closed Freeze)...')

  // 1. GATHER EXPOSURE AND HUMAN REVIEW SOURCES
  const v13Replay = readJson('catalogue-pipeline/experiments/verifier-v1.2-retrospective-replay/cohort-manifest.v1.json')
  const v13Ids = new Set(v13Replay.records.map((r) => r.candidateId))

  const fnTaxonomy = readJson('catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/semantic-false-negative-taxonomy.v1.json')
  const fnIds = new Set(fnTaxonomy.cases.map((c) => c.candidateId))

  const ablation = readJson('catalogue-pipeline/experiments/verifier-v1.3-low-thinking-technical-ablation/ablation-cohort.v1.json')
  const ablationIds = new Set(ablation.records.map((r) => r.candidateId))

  const t1Repair = readJson('catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/targeted-editorial-repair-results.v1.json')
  const t1RepairIds = new Set(t1Repair.records.map((r) => r.candidateId))

  const t2Repair = readJson('catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/targeted-editorial-repair-plan.v1.json')
  const t2RepairIds = new Set(t2Repair.records ? t2Repair.records.map((r) => r.candidateId) : Object.keys(t2Repair.repairs || {}))

  const pilotFixtures = [
    'scale500-tmdb-14283',
    'scale500-tmdb-347201',
    'scale500-tmdb-25237',
    'exp100-tmdb-21316',
    'scale500-tmdb-2061',
    'scale500-tmdb-535167',
    'exp100-tmdb-144',
    'exp100-tmdb-2023',
    'scale500-tmdb-10389',
    'scale500-tmdb-11314',
    'scale500-tmdb-11416',
    'scale500-tmdb-13752',
    'scale500-tmdb-15764',
    'scale500-tmdb-256040',
    'scale500-tmdb-30017',
    'scale500-tmdb-477018',
  ]
  const pilotFixtureIds = new Set(pilotFixtures)

  // Pure development-exposed candidates (53 candidates)
  const devExposedIds = new Set([
    ...v13Ids,
    ...fnIds,
    ...ablationIds,
    ...t1RepairIds,
    ...t2RepairIds,
    ...pilotFixtureIds,
  ])

  // Historical human-reviewed candidates (70 unique candidates)
  const pilotHuman = readJson('catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/review/human-review-decisions.completed.v1.json')
  const pilotHumanIds = new Set(pilotHuman.records.map((r) => r.candidateId))

  const t1Human = readJson('catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/human-review-decisions.completed.v1.json')
  const t1HumanIds = new Set(t1Human.records.map((r) => r.candidateId))

  const t2Human = readJson('catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/human-review-decisions.v1.json')
  const t2HumanIds = new Set(t2Human.records.map((r) => r.candidateId))

  const priorHumanIds = new Set([
    ...pilotHumanIds,
    ...t1HumanIds,
    ...t2HumanIds,
  ])

  const totalEvaluationExcludedIds = new Set([
    ...devExposedIds,
    ...priorHumanIds,
  ])

  // 2. CONSTRUCT REFINED SEMANTIC EXPOSURE LEDGER V2
  const exposureLedgerRecords = []
  for (const id of [...totalEvaluationExcludedIds].sort()) {
    const isDevExposed = devExposedIds.has(id)
    const isPriorHuman = priorHumanIds.has(id)
    const devReasons = []
    const humanTranches = []
    const sources = []

    if (v13Ids.has(id)) {
      devReasons.push('V13_RETROSPECTIVE_REPLAY_COHORT')
      sources.push('catalogue-pipeline/experiments/verifier-v1.2-retrospective-replay/cohort-manifest.v1.json')
    }
    if (fnIds.has(id)) {
      devReasons.push('SEMANTIC_FALSE_NEGATIVE_TAXONOMY_INSPECTION')
      sources.push('catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/semantic-false-negative-taxonomy.v1.json')
    }
    if (ablationIds.has(id)) {
      devReasons.push('LOW_THINKING_TECHNICAL_ABLATION_FAILURE_ENRICHMENT')
      sources.push('catalogue-pipeline/experiments/verifier-v1.3-low-thinking-technical-ablation/ablation-cohort.v1.json')
    }
    if (t1RepairIds.has(id)) {
      devReasons.push('TRANCHE_1_TARGETED_EDITORIAL_REPAIR')
      sources.push('catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/targeted-editorial-repair-results.v1.json')
    }
    if (t2RepairIds.has(id)) {
      devReasons.push('TRANCHE_2_TARGETED_EDITORIAL_REPAIR')
      sources.push('catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/targeted-editorial-repair-plan.v1.json')
    }
    if (pilotFixtureIds.has(id)) {
      devReasons.push('PILOT_WRITER_CRITIC_DEVELOPMENT_FIXTURE')
      sources.push('catalogue-pipeline/scripts/editorialPilot.mjs')
    }

    if (pilotHumanIds.has(id)) {
      humanTranches.push('PILOT_HUMAN_ADJUDICATION')
      sources.push('catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/review/human-review-decisions.completed.v1.json')
    }
    if (t1HumanIds.has(id)) {
      humanTranches.push('TRANCHE_1_HUMAN_ADJUDICATION')
      sources.push('catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/human-review-decisions.completed.v1.json')
    }
    if (t2HumanIds.has(id)) {
      humanTranches.push('TRANCHE_2_HUMAN_ADJUDICATION')
      sources.push('catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/human-review-decisions.v1.json')
    }

    exposureLedgerRecords.push({
      candidateId: id,
      exclusionClass: isDevExposed ? 'DEVELOPMENT_EXPOSED' : 'PRIOR_HUMAN_ADJUDICATION',
      isDevelopmentExposed: isDevExposed,
      isPriorHumanAdjudicated: isPriorHuman,
      developmentExposureReasons: devReasons,
      historicalHumanAdjudicationTranches: humanTranches,
      evidenceSourcePaths: [...new Set(sources)],
    })
  }

  const devExposedCount = exposureLedgerRecords.filter((r) => r.isDevelopmentExposed).length
  const priorHumanOnlyCount = exposureLedgerRecords.filter((r) => !r.isDevelopmentExposed && r.isPriorHumanAdjudicated).length
  const overlapCount = exposureLedgerRecords.filter((r) => r.isDevelopmentExposed && r.isPriorHumanAdjudicated).length

  const exposureLedgerArtifact = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    schemaVersion: 'semantic-exposure-ledger.v2',
    activity: 'VERIFIER_V14_P2_1_EXPOSURE_LEDGER',
    governanceState: 'PAUSED_FOR_SEVERE_AUDIT_MISS',
    description: 'Refined semantic exposure ledger separating pure development exposure from prior human adjudication.',
    counts: {
      totalEvaluationExcluded: exposureLedgerRecords.length,
      developmentExposed: devExposedCount,
      priorHumanOnlyExcluded: priorHumanOnlyCount,
      overlap: overlapCount,
    },
    records: exposureLedgerRecords,
  }

  // 3. CONSTRUCT EXPOSURE RECONCILIATION V2
  const reconciliationArtifact = readJson('catalogue-pipeline/experiments/verifier-v1.4-semantic-development/exposure-reconciliation.v2.json')

  // 4. LOAD TRANCHE POOLS AND CONSTRUCT ELIGIBLE RECORD POOL
  const t1CohortManifest = readJson('catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/cohort-manifest.json')
  const t2CohortManifest = readJson('catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/cohort-manifest.json')

  const eligibleRecords = []

  for (const record of t1CohortManifest.records || []) {
    if (totalEvaluationExcludedIds.has(record.candidateId)) continue
    const riskInputRelPath = `catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/execution/scale-tranche-1/risk-verifiers/${record.candidateId}/risk-input.json`
    const absPath = path.join(repoRoot, riskInputRelPath)
    if (!fs.existsSync(absPath)) continue
    const bytes = fs.readFileSync(absPath)
    const byteSha = sha256(bytes)
    eligibleRecords.push({
      candidateId: record.candidateId,
      retrospectiveTranche: 'SCALE_TRANCHE_1',
      frozenRiskInputPath: riskInputRelPath,
      riskInputByteSha256: byteSha,
      provenanceBinding: {
        pipelineOrigin: 'scale-tranche-1-execution',
        sourceExecutionTranche: 'SCALE_TRANCHE_1',
      },
      exposureCheck: 'PASS',
      priorHumanAdjudication: false,
    })
  }

  for (const record of t2CohortManifest.records || []) {
    if (totalEvaluationExcludedIds.has(record.candidateId)) continue
    const riskInputRelPath = `catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/execution/scale-tranche-2/risk-verifiers/${record.candidateId}/risk-input.json`
    const absPath = path.join(repoRoot, riskInputRelPath)
    if (!fs.existsSync(absPath)) continue
    const bytes = fs.readFileSync(absPath)
    const byteSha = sha256(bytes)
    eligibleRecords.push({
      candidateId: record.candidateId,
      retrospectiveTranche: 'SCALE_TRANCHE_2',
      frozenRiskInputPath: riskInputRelPath,
      riskInputByteSha256: byteSha,
      provenanceBinding: {
        pipelineOrigin: 'scale-tranche-2-execution',
        sourceExecutionTranche: 'SCALE_TRANCHE_2',
      },
      exposureCheck: 'PASS',
      priorHumanAdjudication: false,
    })
  }

  eligibleRecords.sort((a, b) => a.candidateId.localeCompare(b.candidateId))

  if (eligibleRecords.length !== 184) {
    throw new Error(`ELIGIBLE_POOL_COUNT_MISMATCH: Expected 184 eligible candidates, found ${eligibleRecords.length}`)
  }

  const eligiblePoolArtifact = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    activity: 'VERIFIER_V1_4_ELIGIBLE_POOL_FREEZE',
    governanceState: 'PAUSED_FOR_SEVERE_AUDIT_MISS',
    blindingIntegrity: {
      defectCategoriesIncluded: false,
      overviewFieldsIncluded: false,
      proseFieldsIncluded: false,
      reviewLabelsIncluded: false,
      riskScoresIncluded: false,
      severityFieldsIncluded: false,
      titleFieldsIncluded: false,
      verifierOutputsIncluded: false,
    },
    records: eligibleRecords,
  }

  // 5. CONSTRUCT FROZEN BLIND REVIEW ORDER
  const seedMaterial = 'VERIFIER_V14_P2_1_BLIND_REVIEW_ORDER|deda014|source-boundary-risk-verifier.v1.4-semantic-development.r1'
  const seedSha256 = 'sha256:' + sha256Hex(seedMaterial)
  const seedShaHex = sha256Hex(seedMaterial)

  const scoredCandidates = eligibleRecords.map((r) => {
    const reviewOrderScore = sha256Hex(`${seedShaHex}\n${r.candidateId}`)
    return {
      candidateId: r.candidateId,
      retrospectiveTranche: r.retrospectiveTranche,
      reviewOrderScore,
    }
  })

  scoredCandidates.sort((a, b) => {
    const cmp = a.reviewOrderScore.localeCompare(b.reviewOrderScore)
    if (cmp !== 0) return cmp
    return a.candidateId.localeCompare(b.candidateId)
  })

  const orderedCandidates = scoredCandidates.map((item, index) => ({
    reviewSequenceIndex: index + 1,
    candidateId: item.candidateId,
    retrospectiveTranche: item.retrospectiveTranche,
    reviewOrderScore: item.reviewOrderScore,
  }))

  const reviewOrderArtifact = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    schemaVersion: 'blind-review-order.v1',
    activity: 'VERIFIER_V14_P2_1_BLIND_REVIEW_ORDER',
    governanceState: 'PAUSED_FOR_SEVERE_AUDIT_MISS',
    seedMaterial,
    seedSha256,
    totalOrderedCandidates: orderedCandidates.length,
    orderedCandidates,
  }

  // 6. PREREQUISITE RETROSPECTIVE INTEGRITY CHECKS (FAIL-CLOSED)
  if (simulatePrerequisiteFailure) {
    throw new Error('SIMULATED_PREREQUISITE_FAILURE: Aborting generator before artifact write.')
  }

  // Disjointness check between curated movies and tranche candidates
  const curatedPath = 'src/data/curatedMovies.ts'
  const curatedContent = fs.readFileSync(path.join(repoRoot, curatedPath), 'utf8')
  const curatedTmdbIds = [...curatedContent.matchAll(/tmdbId:\s*(\d+)/g)].map((m) => Number(m[1])).sort((a, b) => a - b)

  const t1ManifestPath = 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/cohort-manifest.json'
  const t1Cohort = readJson(t1ManifestPath)
  const t1TmdbIds = t1Cohort.records.map((r) => r.tmdbId).sort((a, b) => a - b)

  const t2ManifestPath = 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/cohort-manifest.json'
  const t2Cohort = readJson(t2ManifestPath)
  const t2TmdbIds = t2Cohort.records.map((r) => r.tmdbId).sort((a, b) => a - b)

  const curatedSet = new Set(curatedTmdbIds)
  const t1Intersection = t1TmdbIds.filter((id) => curatedSet.has(id))
  const t2Intersection = t2TmdbIds.filter((id) => curatedSet.has(id))

  if (t1Intersection.length !== 0 || t2Intersection.length !== 0) {
    throw new Error(`HOLDOUT_DISJOINTNESS_FAILURE: Curated overlap detected! T1: ${t1Intersection}, T2: ${t2Intersection}`)
  }

  // 7. CONSTRUCT POOL PROVENANCE ARTIFACT
  const holdoutGovPath = 'catalogue-pipeline/scripts/semanticHoldoutGovernance.mjs'
  const holdoutGovSha = sha256(fs.readFileSync(path.join(repoRoot, holdoutGovPath)))
  const holdoutManifestVersion = 'phase-5-semantic-holdout-manifest.v1'

  const poolProvenanceArtifact = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    schemaVersion: 'blind-review-pool-provenance.v1',
    activity: 'VERIFIER_V1_4_HOLDOUT_FIREWALL_PROVENANCE',
    governanceState: 'PAUSED_FOR_SEVERE_AUDIT_MISS',
    holdoutFirewallStatus: 'LEGACY_HOLDOUT_IDENTITY_GOVERNANCE_DIAGNOSTIC_COMPLETED',
    mechanizedHoldoutDisjointnessProof: {
      proofMethod: 'CANONICAL_TMDB_ID_DISJOINT_SET_VERIFICATION',
      governanceSource: {
        sourcePath: holdoutGovPath,
        sha256: holdoutGovSha,
        sourceUniverseDefinitionVersion: holdoutManifestVersion,
      },
      curatedLegacyCatalogue: {
        sourcePath: curatedPath,
        sha256: sha256(Buffer.from(curatedContent, 'utf8')),
        totalCuratedMovies: curatedTmdbIds.length,
        curatedTmdbIds,
      },
      scaleTranche1Catalogue: {
        sourcePath: t1ManifestPath,
        sha256: sha256(fs.readFileSync(path.join(repoRoot, t1ManifestPath))),
        totalTranche1Movies: t1TmdbIds.length,
        intersectionWithCuratedCount: t1Intersection.length,
        intersectionTmdbIds: t1Intersection,
      },
      scaleTranche2Catalogue: {
        sourcePath: t2ManifestPath,
        sha256: sha256(fs.readFileSync(path.join(repoRoot, t2ManifestPath))),
        totalTranche2Movies: t2TmdbIds.length,
        intersectionWithCuratedCount: t2Intersection.length,
        intersectionTmdbIds: t2Intersection,
      },
      setDisjointnessCalculation: {
        curatedIntersectionTranche1: t1Intersection.length,
        curatedIntersectionTranche2: t2Intersection.length,
        tranche1CuratedDisjoint: t1Intersection.length === 0,
        tranche2CuratedDisjoint: t2Intersection.length === 0,
      },
      subsetPremiseStatus: 'RESOLVED_BY_IDENTITY_FIREWALL_AUDIT',
      holdoutSourceUniverseProofStatus: 'OBSERVED_ZERO_OVERLAP',
      epistemicProofVerdict: 'OBSERVED_ZERO_OVERLAP_LEGACY_HOLDOUT_RETIRED',
      legacyHoldoutStatus: 'LEGACY_HOLDOUT_RETIRED_FROM_FUTURE_PROSPECTIVE_VALIDATION',
      observedHistoricalOverlapCount: 0,
      provenanceAuditNote: '184 candidates are retrospectively unexposed under the reconciled development/prior-human exclusion ledger. Dedicated identity diagnostic historically observed 0 identity overlap across the 184 eligible retrospective candidates. Holdout identity confidentiality was compromised during post-freeze diagnostic execution text; therefore, the legacy holdout is retired from future prospective validation. This activity evaluates retrospective semantic development and does NOT establish prospective validity.',
    },
    eligiblePoolProvenance: {
      eligibleCandidatesCount: eligibleRecords.length,
      allCandidatesPassExposureCheck: true,
      allCandidatesPriorHumanAdjudicationFalse: true,
    },
  }

  // 8. CONSTRUCT SECOND-REVIEW QA PROTOCOL V1
  const qaSeedMaterial = 'VERIFIER_V14_P2_SECOND_REVIEW_QA|deda014|source-boundary-risk-verifier.v1.4-semantic-development.r1'
  const qaSeedSha256 = sha256(Buffer.from(qaSeedMaterial, 'utf8'))

  const secondReviewQaArtifact = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    schemaVersion: 'second-review-qa-protocol.v1',
    activity: 'VERIFIER_V1_4_SECOND_REVIEW_QA_PROTOCOL',
    workflow: 'VERIFIER_BLINDED_AI_ASSISTED_HUMAN_ADJUDICATION',
    governanceState: 'PAUSED_FOR_SEVERE_AUDIT_MISS',
    seedMaterial: qaSeedMaterial,
    seedSha256: qaSeedSha256,
    samplingRules: {
      severeAdjudications: {
        coverage: '100_PERCENT',
        description: 'All candidates whose final human adjudication by Sophia Zhao has severity SEVERE must be audited in second review QA.',
      },
      nonSevereAdjudications: {
        coverage: 'CEIL_25_PERCENT',
        formula: 'ceil(0.25 * nonSevereCompletedCount)',
        description: 'Exactly ceil(0.25 * nonSevereCompletedCount) of non-severe completed adjudications are audited in second review QA.',
        contentBasedSelection: false,
      },
    },
    sampleSelectionAlgorithm: {
      step1: 'Identify all severe final human adjudications (100% inclusion).',
      step2: 'Filter all non-severe final human adjudications and compute targetCount = ceil(0.25 * nonSevereCount).',
      step3: 'For each non-severe candidate, compute qaRankScore = SHA256(qaSeedSha256Hex + "\\n" + candidateId).',
      step4: 'Sort non-severe candidates ascending by qaRankScore, secondary sort candidateId.',
      step5: 'Select top targetCount non-severe candidates.',
      step6: 'Combine severe and selected non-severe cohorts for second review.',
    },
    reviewerAuthorityFramework: {
      primaryGroundTruthAuthority: 'Sophia Zhao (authoritative primary ground truth)',
      secondReviewerRole: 'Independent AI Quality Assurance Audit',
      disagreementHandling: 'All disagreements between primary human adjudication and second review are flagged and escalated to joint reconciliation inspection against A_PRIME_PRODUCTION_MATERIALITY_V1. No automatic overwrite of primary human decision is permitted.',
      epistemicDistinction: 'Second review is an independent model QA audit on primary human decisions; it CANNOT be represented as human inter-rater reliability.',
    },
  }

  // 9. CONSTRUCT ADJUDICATION CORRECTION PROTOCOL V1
  const correctionProtocolArtifact = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    schemaVersion: 'adjudication-correction-protocol.v1',
    activity: 'VERIFIER_V1_4_ADJUDICATION_CORRECTION_PROTOCOL',
    workflow: 'VERIFIER_BLINDED_AI_ASSISTED_HUMAN_ADJUDICATION',
    governanceState: 'PAUSED_FOR_SEVERE_AUDIT_MISS',
    disagreementRules: {
      automaticOverwritesForbidden: true,
      originalSophiaDecisionPreserved: true,
      secondReviewJudgmentPreserved: true,
      silentMutationForbidden: true,
      reconciliationRecordRequired: true,
    },
    resolutionWorkflow: [
      '1. Flag candidate with QA disagreement between primary adjudication and second review.',
      '2. Re-open source packet, primary human rationale, and second review rationale.',
      '3. Conduct joint reconciliation inspection against A_PRIME_PRODUCTION_MATERIALITY_V1.',
      '4. Author a versioned correction record specifying: originalDecision, secondReviewDecision, finalAdjudicatedResolution, rationale, and groundTruthChanged boolean.',
      '5. Commit immutable correction record to disk with cryptographic hash bindings.',
    ],
  }

  // 10. LOAD STATIC & CANONICAL SCHEMAS AND RETIREMENT ARTIFACTS
  const blindPacketSchema = readJson('catalogue-pipeline/experiments/verifier-v1.4-semantic-development/blind-human-review-packet.schema.v1.json')
  const humanAdjudicationSchema = readJson('catalogue-pipeline/experiments/verifier-v1.4-semantic-development/human-adjudication-record.schema.v1.json')
  const preliminaryAdvisorySchema = readJson('catalogue-pipeline/experiments/verifier-v1.4-semantic-development/preliminary-advisory-review.schema.v1.json')
  const preliminaryAdvisoryRecordSchema = readJson('catalogue-pipeline/experiments/verifier-v1.4-semantic-development/preliminary-advisory-record.schema.v1.json')
  const legacyHoldoutRetirementArtifact = readJson('catalogue-pipeline/experiments/verifier-v1.4-semantic-development/legacy-prospective-holdout-retirement.v1.json')
  const sealedFirewallAuditArtifact = readJson('catalogue-pipeline/experiments/verifier-v1.4-semantic-development/sealed-holdout-identity-firewall-audit.v1.json')

  // 11. BIND GENERATOR AND MASTER P2.1 PROTOCOL
  const materialityPolicyPath = 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/human-review-materiality-policy.v1.json'
  const materialityPolicySha = sha256(fs.readFileSync(path.join(repoRoot, materialityPolicyPath)))

  const geminiPromptPath = 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/review-prompts/verifier-v14-gemini-preliminary.v1.md'
  const geminiPromptSha = sha256(fs.readFileSync(path.join(repoRoot, geminiPromptPath)))

  const claudePromptPath = 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/review-prompts/verifier-v14-claude-preliminary.v1.md'
  const claudePromptSha = sha256(fs.readFileSync(path.join(repoRoot, claudePromptPath)))

  const blindPacketSchemaSha = sha256(Buffer.from(serializeArtifactForPersistence(blindPacketSchema), 'utf8'))
  const humanAdjudicationSchemaSha = sha256(Buffer.from(serializeArtifactForPersistence(humanAdjudicationSchema), 'utf8'))
  const preliminaryAdvisorySchemaSha = sha256(Buffer.from(serializeArtifactForPersistence(preliminaryAdvisorySchema), 'utf8'))
  const preliminaryAdvisoryRecordSchemaSha = sha256(Buffer.from(serializeArtifactForPersistence(preliminaryAdvisoryRecordSchema), 'utf8'))

  const blindReviewPacketScriptPath = 'catalogue-pipeline/scripts/blindReviewPacket.mjs'
  const blindReviewPacketScriptSha = sha256(fs.readFileSync(path.join(repoRoot, blindReviewPacketScriptPath)))

  const jsonSchemaValidatorPath = 'catalogue-pipeline/scripts/jsonSchemaValidator.mjs'
  const jsonSchemaValidatorSha = sha256(fs.readFileSync(path.join(repoRoot, jsonSchemaValidatorPath)))

  const validatePromotionContractPath = 'catalogue-pipeline/scripts/validatePromotionContract.mjs'
  const validatePromotionContractSha = sha256(fs.readFileSync(path.join(repoRoot, validatePromotionContractPath)))

  const protocolDocPath = 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/BLIND_HUMAN_REVIEW_PROTOCOL.md'
  const protocolDocSha = sha256(fs.readFileSync(path.join(repoRoot, protocolDocPath)))

  const p21TestPath = 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/p2-1.test.mjs'
  const p21TestSha = fs.existsSync(path.join(repoRoot, p21TestPath))
    ? sha256(fs.readFileSync(path.join(repoRoot, p21TestPath)))
    : null

  const generatorSha = sha256(fs.readFileSync(generatorPath))

  const exposureLedgerSerialized = serializeArtifactForPersistence(exposureLedgerArtifact)
  const exposureReconciliationSerialized = serializeArtifactForPersistence(reconciliationArtifact)
  const eligiblePoolSerialized = serializeArtifactForPersistence(eligiblePoolArtifact)
  const reviewOrderSerialized = serializeArtifactForPersistence(reviewOrderArtifact)
  const poolProvenanceSerialized = serializeArtifactForPersistence(poolProvenanceArtifact)
  const secondReviewQaSerialized = serializeArtifactForPersistence(secondReviewQaArtifact)
  const correctionProtocolSerialized = serializeArtifactForPersistence(correctionProtocolArtifact)
  const legacyHoldoutRetirementSerialized = serializeArtifactForPersistence(legacyHoldoutRetirementArtifact)
  const sealedFirewallAuditSerialized = serializeArtifactForPersistence(sealedFirewallAuditArtifact)

  const p21ProtocolArtifact = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    schemaVersion: 'p2-1-protocol.v1',
    activity: 'VERIFIER_V14_P2_1_BLIND_REVIEW_INFRASTRUCTURE_FREEZE',
    classification: 'RETROSPECTIVE_SEMANTIC_DEVELOPMENT_EVALUATION',
    workflow: 'VERIFIER_BLINDED_AI_ASSISTED_HUMAN_ADJUDICATION',
    governanceState: 'PAUSED_FOR_SEVERE_AUDIT_MISS',
    approvedOption: 'OPTION_B_FRESH_RETROSPECTIVE_BLIND_HUMAN_REVIEW',
    baselineCommit: 'deda014',
    terminologyDeclaration: 'Under VERIFIER_BLINDED_AI_ASSISTED_HUMAN_ADJUDICATION, the human adjudicator (Sophia Zhao) is blinded to Candidate Verifier predictions, historical verifier risk levels, repair histories, and cohort quota pressure, but inspects independent preliminary advisory opinions from Gemini and Claude before rendering the authoritative final human decision. Fully independent unassisted human review is not claimed.',
    bindings: {
      artifactGenerator: {
        path: 'catalogue-pipeline/scripts/buildVerifierV14P21Artifacts.mjs',
        sha256: generatorSha,
      },
      p21Test: {
        path: p21TestPath,
        sha256: p21TestSha,
      },
      p1Protocol: {
        path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/protocol.v1.json',
        sha256: 'sha256:7ccef839cc7bf434156881f6d8c12130a8d5e444e6038a95c50df8572c7c0f4d',
      },
      v14Prompt: {
        path: 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.4.md',
        sha256: 'sha256:a2fe3ef32f5b417544276401d5b520274fc77ef97753da61c253032b3f1e0d7f',
      },
      developmentExposurePolicy: {
        path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/development-exposure-policy.v1.json',
        sha256: 'sha256:b5e9b655644bb0af931bd151b99b9bada8e21f0a8add2a9d8a52ad826b7bb04b',
      },
      promptExposureLint: {
        path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/prompt-exposure-lint.v1.json',
        sha256: 'sha256:5b5eb8c2075b9dab8c8591a12d7055ef82f3a0bc194a029f451c5a8ef926a055',
      },
      materialityPolicy: {
        path: materialityPolicyPath,
        policyId: 'A_PRIME_PRODUCTION_MATERIALITY_V1',
        sha256: materialityPolicySha,
      },
      geminiPreliminaryPrompt: {
        path: geminiPromptPath,
        sha256: geminiPromptSha,
      },
      claudePreliminaryPrompt: {
        path: claudePromptPath,
        sha256: claudePromptSha,
      },
      blindPacketSchema: {
        path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/blind-human-review-packet.schema.v1.json',
        sha256: blindPacketSchemaSha,
      },
      humanAdjudicationSchema: {
        path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/human-adjudication-record.schema.v1.json',
        sha256: humanAdjudicationSchemaSha,
      },
      preliminaryAdvisoryReviewSchema: {
        path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/preliminary-advisory-review.schema.v1.json',
        sha256: preliminaryAdvisorySchemaSha,
      },
      preliminaryAdvisoryRecordEnvelopeSchema: {
        path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/preliminary-advisory-record.schema.v1.json',
        sha256: preliminaryAdvisoryRecordSchemaSha,
      },
      blindReviewPacketScript: {
        path: blindReviewPacketScriptPath,
        sha256: blindReviewPacketScriptSha,
      },
      jsonSchemaValidator: {
        path: jsonSchemaValidatorPath,
        sha256: jsonSchemaValidatorSha,
      },
      validatePromotionContract: {
        path: validatePromotionContractPath,
        sha256: validatePromotionContractSha,
      },
      blindHumanReviewProtocolDoc: {
        path: protocolDocPath,
        sha256: protocolDocSha,
      },
      semanticExposureLedger: {
        path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/semantic-exposure-ledger.v2.json',
        sha256: sha256(Buffer.from(exposureLedgerSerialized, 'utf8')),
      },
      exposureReconciliation: {
        path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/exposure-reconciliation.v2.json',
        sha256: sha256(Buffer.from(exposureReconciliationSerialized, 'utf8')),
      },
      blindReviewEligiblePool: {
        path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/blind-review-eligible-pool.v1.json',
        sha256: sha256(Buffer.from(eligiblePoolSerialized, 'utf8')),
      },
      blindReviewPoolProvenance: {
        path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/blind-review-pool-provenance.v1.json',
        sha256: sha256(Buffer.from(poolProvenanceSerialized, 'utf8')),
      },
      reviewOrder: {
        path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/blind-review-order.v1.json',
        seedMaterial,
        seedSha256,
        sha256: sha256(Buffer.from(reviewOrderSerialized, 'utf8')),
      },
      secondReviewQa: {
        path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/second-review-qa-protocol.v1.json',
        seedMaterial: qaSeedMaterial,
        seedSha256: qaSeedSha256,
        sha256: sha256(Buffer.from(secondReviewQaSerialized, 'utf8')),
      },
      adjudicationCorrection: {
        path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/adjudication-correction-protocol.v1.json',
        sha256: sha256(Buffer.from(correctionProtocolSerialized, 'utf8')),
      },
      sealedHoldoutFirewallAuditScript: {
        path: 'catalogue-pipeline/scripts/runSealedHoldoutIdentityFirewallAudit.mjs',
        sha256: sha256(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/scripts/runSealedHoldoutIdentityFirewallAudit.mjs'))),
      },
      legacyHoldoutRetirement: {
        path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/legacy-prospective-holdout-retirement.v1.json',
        sha256: sha256(Buffer.from(legacyHoldoutRetirementSerialized, 'utf8')),
      },
    },
    reviewAvailabilityPolicy: {
      rule: 'BOTH_PRELIMINARY_ADVISORIES_REQUIRED_BEFORE_PRIMARY_HUMAN_ADJUDICATION',
      pauseStatus: 'REVIEW_PAUSED_PENDING_ADVISORY',
      singleAdvisoryContinuationForbidden: true,
      description: 'If either Gemini or Claude advisory is unavailable, malformed, schema-invalid, or packet-binding-invalid, candidate status becomes REVIEW_PAUSED_PENDING_ADVISORY. Sophia Zhao does NOT issue final ground truth under a single advisory.',
    },
    sequentialReviewStoppingRule: {
      rule: 'Proceed candidate by candidate in frozen blind review order. Review halts if and only if CLEAN >= 30 AND DEFECT_POSITIVE >= 30 AND SEVERE_DEFECT_POSITIVE >= 6.',
      cleanThreshold: 30,
      defectPositiveThreshold: 30,
      severeDefectPositiveThreshold: 6,
      exhaustionVerdict: 'VERIFIER_V14_P2_REVIEW_POOL_INSUFFICIENT',
    },
    finalEvaluationCohortRequirements: {
      totalCohortN: 60,
      cleanCount: 30,
      defectPositiveCount: 30,
      minimumSevereInFinalEvaluationCohort: 6,
      exactSevereRequirement: false,
    },
    modelAgreementGovernance: {
      preliminaryOpinionsAdvisoryOnly: true,
      independentQueryRequired: true,
      descriptiveMetricsOnly: true,
      agreementDoesNotDetermineCohortOrQuotas: true,
    },
    taxonomyGeneralizationLimitation: 'The 184 fresh retrospective records are row-level unexposed candidates from the same historical catalogue-generation regime as earlier development data. Therefore a successful v1.4 study may support independent-record retrospective development performance within this catalogue-generation regime, but does NOT establish cross-pipeline generalization, cross-provider generalization, prospective validity, or production readiness.',
  }

  const p21ProtocolSerialized = serializeArtifactForPersistence(p21ProtocolArtifact)

  // 12. CONSTRUCT FREEZE MANIFEST
  const manifestArtifacts = {
    p1Protocol: {
      path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/protocol.v1.json',
      sha256: sha256(fs.readFileSync(path.join(p2Dir, 'protocol.v1.json'))),
    },
    v14Prompt: {
      path: 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.4.md',
      sha256: sha256(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.4.md'))),
    },
    p21Protocol: {
      path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/p2-1-protocol.v1.json',
      sha256: sha256(Buffer.from(p21ProtocolSerialized, 'utf8')),
    },
    exposureLedger: {
      path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/semantic-exposure-ledger.v2.json',
      sha256: sha256(Buffer.from(exposureLedgerSerialized, 'utf8')),
    },
    exposureReconciliation: {
      path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/exposure-reconciliation.v2.json',
      sha256: sha256(Buffer.from(exposureReconciliationSerialized, 'utf8')),
    },
    eligiblePool: {
      path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/blind-review-eligible-pool.v1.json',
      sha256: sha256(Buffer.from(eligiblePoolSerialized, 'utf8')),
    },
    reviewOrder: {
      path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/blind-review-order.v1.json',
      sha256: sha256(Buffer.from(reviewOrderSerialized, 'utf8')),
    },
    blindReviewProvenance: {
      path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/blind-review-pool-provenance.v1.json',
      sha256: sha256(Buffer.from(poolProvenanceSerialized, 'utf8')),
    },
    sealedFirewallAuditResult: {
      path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/sealed-holdout-identity-firewall-audit.v1.json',
      sha256: sha256(Buffer.from(sealedFirewallAuditSerialized, 'utf8')),
    },
    sealedFirewallScript: {
      path: 'catalogue-pipeline/scripts/runSealedHoldoutIdentityFirewallAudit.mjs',
      sha256: sha256(fs.readFileSync(path.join(repoRoot, 'catalogue-pipeline/scripts/runSealedHoldoutIdentityFirewallAudit.mjs'))),
    },
    legacyHoldoutRetirement: {
      path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/legacy-prospective-holdout-retirement.v1.json',
      sha256: sha256(Buffer.from(legacyHoldoutRetirementSerialized, 'utf8')),
    },
    packetProjectionHelper: {
      path: 'catalogue-pipeline/scripts/blindReviewPacket.mjs',
      sha256: sha256(fs.readFileSync(path.join(repoRoot, blindReviewPacketScriptPath))),
    },
    schemaValidator: {
      path: 'catalogue-pipeline/scripts/jsonSchemaValidator.mjs',
      sha256: sha256(fs.readFileSync(path.join(repoRoot, jsonSchemaValidatorPath))),
    },
    blindPacketSchema: {
      path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/blind-human-review-packet.schema.v1.json',
      sha256: blindPacketSchemaSha,
    },
    humanAdjudicationSchema: {
      path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/human-adjudication-record.schema.v1.json',
      sha256: humanAdjudicationSchemaSha,
    },
    preliminaryAdvisoryReviewSchema: {
      path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/preliminary-advisory-review.schema.v1.json',
      sha256: preliminaryAdvisorySchemaSha,
    },
    preliminaryAdvisoryRecordEnvelopeSchema: {
      path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/preliminary-advisory-record.schema.v1.json',
      sha256: preliminaryAdvisoryRecordSchemaSha,
    },
    geminiPreliminaryPrompt: {
      path: geminiPromptPath,
      sha256: sha256(fs.readFileSync(path.join(repoRoot, geminiPromptPath))),
    },
    claudePreliminaryPrompt: {
      path: claudePromptPath,
      sha256: sha256(fs.readFileSync(path.join(repoRoot, claudePromptPath))),
    },
    materialityPolicy: {
      path: materialityPolicyPath,
      sha256: sha256(fs.readFileSync(path.join(repoRoot, materialityPolicyPath))),
    },
    secondReviewQaProtocol: {
      path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/second-review-qa-protocol.v1.json',
      sha256: sha256(Buffer.from(secondReviewQaSerialized, 'utf8')),
    },
    correctionProtocol: {
      path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/adjudication-correction-protocol.v1.json',
      sha256: sha256(Buffer.from(correctionProtocolSerialized, 'utf8')),
    },
    generator: {
      path: 'catalogue-pipeline/scripts/buildVerifierV14P21Artifacts.mjs',
      sha256: sha256(fs.readFileSync(generatorPath)),
    },
    p21Tests: {
      path: p21TestPath,
      sha256: sha256(fs.readFileSync(path.join(repoRoot, p21TestPath))),
    },
    blindHumanReviewProtocolDoc: {
      path: protocolDocPath,
      sha256: sha256(fs.readFileSync(path.join(repoRoot, protocolDocPath))),
    },
  }

  const freezeManifestArtifact = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    schemaVersion: 'p2-1-freeze-manifest.v1',
    activity: 'VERIFIER_V14_P2_1_FREEZE_MANIFEST',
    classification: 'RETROSPECTIVE_SEMANTIC_DEVELOPMENT_EVALUATION',
    governanceState: 'PAUSED_FOR_SEVERE_AUDIT_MISS',
    approvedOption: 'OPTION_B_FRESH_RETROSPECTIVE_BLIND_HUMAN_REVIEW',
    totalGovernedArtifactsCount: Object.keys(manifestArtifacts).length,
    artifacts: manifestArtifacts,
  }

  const freezeManifestSerialized = serializeArtifactForPersistence(freezeManifestArtifact)

  // 13. ATOMIC WRITE OF ALL GOVERNED ARTIFACTS TO TARGET DIRECTORY
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  fs.writeFileSync(path.join(outputDir, 'semantic-exposure-ledger.v2.json'), exposureLedgerSerialized)
  fs.writeFileSync(path.join(outputDir, 'exposure-reconciliation.v2.json'), exposureReconciliationSerialized)
  fs.writeFileSync(path.join(outputDir, 'blind-review-eligible-pool.v1.json'), eligiblePoolSerialized)
  fs.writeFileSync(path.join(outputDir, 'blind-review-order.v1.json'), reviewOrderSerialized)
  fs.writeFileSync(path.join(outputDir, 'blind-review-pool-provenance.v1.json'), poolProvenanceSerialized)
  fs.writeFileSync(path.join(outputDir, 'second-review-qa-protocol.v1.json'), secondReviewQaSerialized)
  fs.writeFileSync(path.join(outputDir, 'adjudication-correction-protocol.v1.json'), correctionProtocolSerialized)
  fs.writeFileSync(path.join(outputDir, 'blind-human-review-packet.schema.v1.json'), serializeArtifactForPersistence(blindPacketSchema))
  fs.writeFileSync(path.join(outputDir, 'human-adjudication-record.schema.v1.json'), serializeArtifactForPersistence(humanAdjudicationSchema))
  fs.writeFileSync(path.join(outputDir, 'preliminary-advisory-review.schema.v1.json'), serializeArtifactForPersistence(preliminaryAdvisorySchema))
  fs.writeFileSync(path.join(outputDir, 'preliminary-advisory-record.schema.v1.json'), serializeArtifactForPersistence(preliminaryAdvisoryRecordSchema))
  fs.writeFileSync(path.join(outputDir, 'legacy-prospective-holdout-retirement.v1.json'), legacyHoldoutRetirementSerialized)
  fs.writeFileSync(path.join(outputDir, 'sealed-holdout-identity-firewall-audit.v1.json'), sealedFirewallAuditSerialized)
  fs.writeFileSync(path.join(outputDir, 'p2-1-protocol.v1.json'), p21ProtocolSerialized)
  fs.writeFileSync(path.join(outputDir, 'p2-1-freeze-manifest.v1.json'), freezeManifestSerialized)

  console.log('Successfully generated all hardened P2.1 governed artifacts and final freeze manifest.')
  return {
    manifest: freezeManifestArtifact,
    artifactsCount: Object.keys(manifestArtifacts).length,
  }
}

// Self-execute if run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildP21Artifacts().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
