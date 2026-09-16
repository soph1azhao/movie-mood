import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { buildEditorialGeminiSchema, GEMINI_EDITORIAL_MODEL_ID, GEMINI_EDITORIAL_PROVIDER_ID, THINKING_LEVELS } from '../adapters/geminiEditorialProvider.mjs'
import { WRITER_MAX_OUTPUT_TOKENS } from './editorialPilot.mjs'
import { hashArtifact, hashBytes, serializeArtifactForPersistence, validateEditorialArtifact } from './validatePromotionContract.mjs'

export const VALID_SEMANTIC_STATES = Object.freeze(new Set(['IMPORTED_VALID', 'LOW_VALID', 'HIGH_VALID', 'MAX_VALID']))

export const DEFAULT_ROUTING_POLICY_VERSION = 'scale-tranche-risk-router.v1'
export const DEFAULT_RISK_VERIFIER_VERSION = 'source-boundary-risk-verifier.v1'
export const DEFAULT_STRUCTURAL_REPAIR_VERSION = 'editorial-structural-repair.v1'
export const DEFAULT_PROMOTION_STATES = Object.freeze(['GENERATED', 'STRUCTURAL_VALID', 'STRUCTURAL_REPAIRED', 'HIGH_RISK', 'AUTO_ELIGIBLE', 'AUDIT_PENDING', 'HUMAN_REVIEW_PENDING', 'QUARANTINED', 'PROMOTION_ELIGIBLE'])
export const DEFAULT_SEVERE_AUDIT_MISS_BEHAVIOR = Object.freeze(['PAUSE_CURRENT_TRANCHE', 'STOP_PROMOTION_FINALIZATION', 'INCREASE_AUDIT', 'DIAGNOSE_FAILURE_CLASS'])

export function computeCandidateIdKey(seedId, candidateId) {
  if (!seedId || typeof seedId !== 'string') throw new Error('seedId must be a non-empty string')
  if (!candidateId || typeof candidateId !== 'string') throw new Error('candidateId must be a non-empty string')
  return createHash('sha256').update(`${seedId}|${candidateId}`).digest('hex')
}

export function hashCandidateSet(candidateIds) {
  if (!Array.isArray(candidateIds)) throw new Error('candidateIds must be an array')
  const sorted = [...candidateIds].sort()
  return hashArtifact(sorted)
}

export function resolveSemanticArtifactPath(repoRoot, state, candidateId) {
  const recorded = state?.lifetimeProvenance?.artifactPath ?? state?.artifactPath
  if (recorded) {
    const marker = `${path.sep}catalogue-pipeline${path.sep}`
    const markerIndex = recorded.indexOf(marker)
    const resolved = markerIndex >= 0 ? path.join(repoRoot, recorded.slice(markerIndex + 1)) : path.resolve(recorded)
    if (existsSync(resolved)) return resolved
  }
  const sourceRunId = state?.lifetimeProvenance?.sourceRunId
  if (sourceRunId) {
    const fallback = path.join(repoRoot, 'catalogue-pipeline/generated/semantic/batches', sourceRunId, 'artifacts', `${candidateId}.json`)
    if (existsSync(fallback)) return fallback
  }
  throw new Error(`Cannot resolve semantic artifact: ${candidateId}`)
}

export function loadAndValidateAuthoritativeCandidatePool({ semanticCohort, semanticManifest, validStatuses = VALID_SEMANTIC_STATES }) {
  if (!semanticCohort || !Array.isArray(semanticCohort.importedCandidates) || !Array.isArray(semanticCohort.newCandidates)) {
    throw new Error('Invalid semantic cohort structure')
  }
  if (!semanticManifest || !semanticManifest.states || typeof semanticManifest.states !== 'object') {
    throw new Error('Invalid semantic manifest structure')
  }
  const entries = [...semanticCohort.importedCandidates, ...semanticCohort.newCandidates]
  const candidateIds = entries.map((entry) => entry.candidateId)
  if (entries.length !== 400 || semanticManifest.candidateCount !== 400) {
    throw new Error(`Semantic-400 count mismatch: cohort=${entries.length}, manifest=${semanticManifest.candidateCount}`)
  }
  const uniqueIds = new Set(candidateIds)
  if (uniqueIds.size !== 400) {
    throw new Error(`Semantic-400 contains duplicate candidate IDs: unique count = ${uniqueIds.size}`)
  }
  const allowedSet = validStatuses instanceof Set ? validStatuses : new Set(validStatuses)
  for (const candidateId of candidateIds) {
    const st = semanticManifest.states[candidateId]
    if (!st || !allowedSet.has(st.status)) {
      throw new Error(`Candidate ${candidateId} has invalid or missing semantic state: ${st?.status}`)
    }
  }
  return { candidateIds, entries }
}

export function computeAuthoritativeAccounting({ semanticManifest, t1CohortManifest, t1ProductionAssembly, pilotManifest, fixedPilotIds }) {
  const s400Ids = Object.keys(semanticManifest.states).sort()
  if (s400Ids.length !== 400) throw new Error(`Expected exactly 400 candidates in Semantic-400, got ${s400Ids.length}`)

  const t1CohortIds = t1CohortManifest.records.map((r) => r.candidateId).sort()
  if (t1CohortIds.length !== 100) throw new Error(`Expected exactly 100 candidates in T1 cohort, got ${t1CohortIds.length}`)

  const t1CompleteIds = t1ProductionAssembly.records.map((r) => r.candidateId).sort()
  if (t1CompleteIds.length !== 99) throw new Error(`Expected exactly 99 complete candidates in T1 production assembly, got ${t1CompleteIds.length}`)

  const t1DeferredIds = (t1ProductionAssembly.deferredCandidates || []).map((r) => r.candidateId).sort()
  if (t1DeferredIds.length !== 1) throw new Error(`Expected exactly 1 deferred candidate in T1 production assembly, got ${t1DeferredIds.length}`)

  const pilot16Ids = (pilotManifest ? pilotManifest.packets.map((p) => p.candidateId) : fixedPilotIds).sort()
  if (pilot16Ids.length !== 16) throw new Error(`Expected exactly 16 pilot candidates, got ${pilot16Ids.length}`)

  const t1Set = new Set(t1CohortIds)
  const t1CompleteSet = new Set(t1CompleteIds)
  const t1DeferredSet = new Set(t1DeferredIds)
  const pilotSet = new Set(pilot16Ids)

  // Verify T1 cohort is the disjoint union of complete and deferred
  if (t1CompleteIds.length + t1DeferredIds.length !== t1CohortIds.length) {
    throw new Error('T1 complete and deferred counts do not sum to T1 cohort size')
  }
  for (const id of t1DeferredIds) {
    if (t1CompleteSet.has(id)) throw new Error(`T1 deferred candidate ${id} also marked complete`)
    if (!t1Set.has(id)) throw new Error(`T1 deferred candidate ${id} not in T1 cohort`)
  }

  // Normal remaining pool is S400 minus T1 cohort
  const normalRemaining300Ids = s400Ids.filter((id) => !t1Set.has(id)).sort()
  if (normalRemaining300Ids.length !== 300) {
    throw new Error(`Expected 300 normal remaining candidates, got ${normalRemaining300Ids.length}`)
  }
  const normalRemainingSet = new Set(normalRemaining300Ids)

  // Fresh 284 is normal remaining minus 16 pilot
  const fresh284Ids = normalRemaining300Ids.filter((id) => !pilotSet.has(id)).sort()
  if (fresh284Ids.length !== 284) {
    throw new Error(`Expected 284 fresh candidates, got ${fresh284Ids.length}`)
  }

  const pilotInRemaining = normalRemaining300Ids.filter((id) => pilotSet.has(id)).sort()
  if (pilotInRemaining.length !== 16) {
    throw new Error(`Expected all 16 pilot candidates to be in normal remaining pool, got ${pilotInRemaining.length}`)
  }

  // Total unresolved: normalRemaining300 + deferredFromPriorTranche (1)
  const unresolved301Ids = [...normalRemaining300Ids, ...t1DeferredIds].sort()
  if (unresolved301Ids.length !== 301) {
    throw new Error(`Expected 301 total unresolved candidates, got ${unresolved301Ids.length}`)
  }

  // Invariant verification
  for (const id of normalRemaining300Ids) {
    if (t1CompleteSet.has(id)) throw new Error(`Invariant failed: candidate ${id} in both normalRemaining and t1Complete`)
    if (t1DeferredSet.has(id)) throw new Error(`Invariant failed: candidate ${id} in both normalRemaining and t1Deferred`)
  }
  for (const id of fresh284Ids) {
    if (pilotSet.has(id)) throw new Error(`Invariant failed: candidate ${id} in both fresh284 and pilot16`)
  }
  if (pilotInRemaining.length + fresh284Ids.length !== normalRemaining300Ids.length) {
    throw new Error('Invariant failed: PILOT16 ∪ FRESH284 !== NORMAL_REMAINING300')
  }
  if (t1CompleteIds.length + t1DeferredIds.length + normalRemaining300Ids.length !== s400Ids.length) {
    throw new Error('Invariant failed: T1_COMPLETE ∪ T1_DEFERRED ∪ NORMAL_REMAINING300 !== S400')
  }

  const setHashes = {
    s400: hashCandidateSet(s400Ids),
    t1: hashCandidateSet(t1CohortIds),
    t1Complete: hashCandidateSet(t1CompleteIds),
    t1Deferred: hashCandidateSet(t1DeferredIds),
    pilot16: hashCandidateSet(pilot16Ids),
    fresh284: hashCandidateSet(fresh284Ids),
    normalRemaining300: hashCandidateSet(normalRemaining300Ids),
    unresolved301: hashCandidateSet(unresolved301Ids),
  }

  return {
    semanticTotal: s400Ids.length,
    t1CohortTotal: t1CohortIds.length,
    productionComplete: t1CompleteIds.length,
    deferredFromPriorTranche: t1DeferredIds.length,
    normalRemainingPool: normalRemaining300Ids.length,
    pilotCount: pilot16Ids.length,
    freshCount: fresh284Ids.length,
    totalUnresolved: unresolved301Ids.length,
    sets: {
      s400Ids,
      t1CohortIds,
      t1CompleteIds,
      t1DeferredIds,
      pilot16Ids,
      fresh284Ids,
      normalRemaining300Ids,
      unresolved301Ids,
    },
    setHashes,
    invariantsSatisfied: true,
  }
}

export function filterCandidatePool({ candidatePool, excludedCandidateIds = [] }) {
  if (!Array.isArray(candidatePool)) throw new Error('candidatePool must be an array')
  if (new Set(candidatePool).size !== candidatePool.length) {
    throw new Error('candidatePool contains duplicate candidate IDs')
  }
  const excludedSet = new Set(excludedCandidateIds)
  return candidatePool.filter((id) => !excludedSet.has(id))
}

export function selectCohortCandidateIds({ candidatePool, trancheSize, cohortSeed }) {
  if (!Array.isArray(candidatePool)) throw new Error('candidatePool must be an array')
  if (!Number.isInteger(trancheSize) || trancheSize <= 0) {
    throw new Error(`trancheSize must be a positive integer, got ${trancheSize}`)
  }
  if (!cohortSeed || typeof cohortSeed !== 'string') {
    throw new Error('cohortSeed must be a non-empty string')
  }
  if (candidatePool.length < trancheSize) {
    throw new Error(`candidatePool has ${candidatePool.length} candidates, but trancheSize is ${trancheSize}`)
  }
  if (new Set(candidatePool).size !== candidatePool.length) {
    throw new Error('candidatePool contains duplicate candidate IDs')
  }

  // Deterministic seeded sort independent of initial array ordering
  const sorted = candidatePool.slice().sort((a, b) => {
    const keyA = computeCandidateIdKey(cohortSeed, a)
    const keyB = computeCandidateIdKey(cohortSeed, b)
    return keyA.localeCompare(keyB)
  })

  return sorted.slice(0, trancheSize)
}

export function selectAuditCandidateIds({ autoEligibleCandidateIds, auditRate = 0.20, auditSeed }) {
  if (!Array.isArray(autoEligibleCandidateIds)) throw new Error('autoEligibleCandidateIds must be an array')
  if (typeof auditRate !== 'number' || auditRate <= 0 || auditRate > 1 || Number.isNaN(auditRate)) {
    throw new Error(`auditRate must be a number in (0, 1], got ${auditRate}`)
  }
  if (!auditSeed || typeof auditSeed !== 'string') {
    throw new Error('auditSeed must be a non-empty string')
  }
  const unique = [...new Set(autoEligibleCandidateIds)]
  if (unique.length !== autoEligibleCandidateIds.length) {
    throw new Error('Audit pool contains duplicate candidate IDs')
  }
  const auditCount = Math.ceil(unique.length * auditRate)
  const selected = unique.slice().sort((a, b) => {
    const keyA = computeCandidateIdKey(auditSeed, a)
    const keyB = computeCandidateIdKey(auditSeed, b)
    return keyA.localeCompare(keyB)
  }).slice(0, auditCount)

  return {
    auditAlgorithm: 'sha256-lexicographic.v1',
    seedId: auditSeed,
    eligiblePoolCount: unique.length,
    auditRate,
    auditCount,
    orderedAuditCandidateIdsHash: hashArtifact(selected),
    candidateIds: selected,
  }
}

export async function auditPilotCandidates({ repoRoot, pilotCandidateIds, semanticManifest, expansionFacts, scaleFacts, currentWriterPromptVersion = 'editorial-writer.v1.1' }) {
  const allFacts = new Map([...expansionFacts.facts, ...scaleFacts.facts].map((f) => [f.candidateId, f]))
  const writersBase = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/execution/writers')

  const records = []
  let reusableCount = 0
  let freshWriterCount = 0
  let indeterminateCount = 0

  for (const candidateId of pilotCandidateIds) {
    const facts = allFacts.get(candidateId)
    const state = semanticManifest.states[candidateId]
    if (!facts || !state) {
      records.push({
        candidateId,
        classification: 'INDETERMINATE',
        reasons: ['MISSING_AUTHORITATIVE_SOURCE_BINDING'],
        existingWriterArtifactFound: false,
        contractCompliant: false,
      })
      indeterminateCount++
      continue
    }

    const tmdbId = facts.tmdbId
    const writerDir = path.join(writersBase, candidateId)
    const artifactPath = path.join(writerDir, 'writers-artifact.json')

    if (!existsSync(artifactPath)) {
      records.push({
        candidateId,
        tmdbId,
        classification: 'REQUIRES_FRESH_WRITER',
        reasons: ['NO_COMPLETED_WRITER_ARTIFACT: Historical pilot execution did not complete a writer artifact (e.g. HTTP 503 during pilot).'],
        existingWriterArtifactFound: false,
        contractCompliant: false,
      })
      freshWriterCount++
      continue
    }

    // Inspect completed artifact
    let artifact
    try {
      artifact = JSON.parse(await readFile(artifactPath, 'utf8'))
    } catch {
      records.push({
        candidateId,
        tmdbId,
        classification: 'REQUIRES_FRESH_WRITER',
        reasons: ['CORRUPTED_WRITER_ARTIFACT: Existing file could not be parsed.'],
        existingWriterArtifactFound: true,
        contractCompliant: false,
      })
      freshWriterCount++
      continue
    }

    // Verify source hashes
    const evRoot = candidateId.startsWith('exp100-') ? 'expansion-100-v1' : 'scale-500-v1'
    const evPath = path.join(repoRoot, `catalogue-pipeline/generated/catalogue-expansion/${evRoot}/evidence-packets/${candidateId}.json`)
    const evPacket = JSON.parse(await readFile(evPath, 'utf8'))
    const currentEvHash = hashArtifact(evPacket)

    const semPath = resolveSemanticArtifactPath(repoRoot, state, candidateId)
    const semArtifact = JSON.parse(await readFile(semPath, 'utf8'))
    const currentSemHash = hashArtifact(semArtifact)

    const currentFactsHash = hashArtifact(facts)

    const sourceHashesMatch = (
      artifact.sourceHashes?.semanticArtifact === currentSemHash &&
      artifact.sourceHashes?.evidencePacket === currentEvHash &&
      artifact.sourceHashes?.factsRecord === currentFactsHash
    )

    const structuralResult = validateEditorialArtifact(artifact)
    const promptVersionMatches = artifact.output?.promptVersion === currentWriterPromptVersion

    const reasons = []
    if (!sourceHashesMatch) reasons.push('STALE_SOURCE_HASHES: Existing artifact source hashes do not match current authoritative inputs.')
    if (!structuralResult.ok) reasons.push(`STRUCTURAL_SCHEMA_INVALID: ${structuralResult.hardFailures.join('; ')}`)
    if (!promptVersionMatches) {
      reasons.push(`SUPERSEDED_PROMPT_VERSION: Historical writer output used ${artifact.output?.promptVersion ?? 'unknown'}, but current production contract requires ${currentWriterPromptVersion}.`)
    }

    if (sourceHashesMatch && structuralResult.ok && promptVersionMatches) {
      records.push({
        candidateId,
        tmdbId,
        classification: 'REUSABLE_EXISTING_WRITER',
        reasons: ['Artifact satisfies all current production contracts, schema validity, and fresh source bindings.'],
        existingWriterArtifactFound: true,
        contractCompliant: true,
        checkedHashes: {
          semanticArtifact: currentSemHash,
          evidencePacket: currentEvHash,
          factsRecord: currentFactsHash,
        },
      })
      reusableCount++
    } else {
      records.push({
        candidateId,
        tmdbId,
        classification: 'REQUIRES_FRESH_WRITER',
        reasons,
        existingWriterArtifactFound: true,
        contractCompliant: false,
        checkedHashes: {
          semanticArtifact: currentSemHash,
          evidencePacket: currentEvHash,
          factsRecord: currentFactsHash,
          artifactHistoricalHashes: artifact.sourceHashes,
        },
        historicalPromptVersion: artifact.output?.promptVersion,
        requiredPromptVersion: currentWriterPromptVersion,
      })
      freshWriterCount++
    }
  }

  return {
    schemaVersion: 'pilot-reuse-audit.v1',
    auditType: 'PILOT_WRITER_REUSE_AUDIT',
    totalAudited: pilotCandidateIds.length,
    reusableCount,
    freshWriterCount,
    indeterminateCount,
    records,
    auditSummary: {
      zeroNetworkCalls: true,
      zeroModelCalls: true,
      reusableArtifactsPermitted: reusableCount > 0,
      freshWriterCallsMandated: freshWriterCount,
    },
  }
}

export function buildCohortManifest({
  trancheId,
  schemaVersion = 'scale-tranche-cohort-manifest.v1',
  trancheSize,
  cohortSeed,
  selectionAlgorithm = 'sha256-lexicographic.v1',
  sourceCount = 400,
  normalRemainingCount = 300,
  selectedCandidateIds,
  sourcePoolCandidateIds,
  excludedCandidateIds = [],
  priorDeferredCandidateIds = [],
  pilotCandidateIds = [],
  pilotReuseAudit = null,
  sourceManifestBindings,
  records,
}) {
  if (!trancheId) throw new Error('trancheId is required')
  if (!selectedCandidateIds || selectedCandidateIds.length !== trancheSize) {
    throw new Error(`selectedCandidateIds length (${selectedCandidateIds?.length}) does not match trancheSize (${trancheSize})`)
  }
  if (!records || records.length !== trancheSize) {
    throw new Error(`records length (${records?.length}) does not match trancheSize (${trancheSize})`)
  }

  const pilotSet = new Set(pilotCandidateIds)
  const priorDeferredSet = new Set(priorDeferredCandidateIds)
  for (const id of selectedCandidateIds) {
    if (priorDeferredSet.has(id)) {
      throw new Error(`Deferred candidate ${id} from prior tranche selected into cohort`)
    }
  }

  const pilotSelectedCount = selectedCandidateIds.filter((id) => pilotSet.has(id)).length
  const freshSelectedCount = selectedCandidateIds.filter((id) => !pilotSet.has(id)).length

  const manifest = {
    schemaVersion,
    trancheId,
    sourceCount,
    normalRemainingCount,
    trancheSize,
    selectionAlgorithm,
    seedId: cohortSeed,
    sourcePoolHash: sourcePoolCandidateIds ? hashCandidateSet(sourcePoolCandidateIds) : null,
    excludedPriorDeferredIds: priorDeferredCandidateIds,
    excludedCandidateIdsCount: excludedCandidateIds.length,
    orderedCandidateIdsHash: hashArtifact(selectedCandidateIds),
    cohortSummary: {
      totalSelected: trancheSize,
      pilotSelectedCount,
      freshSelectedCount,
    },
    sourceManifestBindings,
    records,
  }

  return manifest
}

export function buildExecutionPlan({
  trancheId,
  schemaVersion = 'scale-tranche-execution-plan.v1',
  trancheSize,
  auditRate = 0.20,
  auditSeed,
  auditAlgorithm = 'sha256-lexicographic.v1',
  selectedCandidateIds,
  cohortManifestHash,
  pilotReuseAudit,
  maxBudgetUSD = 2.00,
  empiricalExpectedUSD = 1.074,
  pessimisticTheoreticalUSD = 1.595,
  expectedModelCalls = 310,
  normalWriterCallCap = 150,
  ambiguousRecoveryWriterCallCap = 1,
  writerCallsMaximum = normalWriterCallCap + ambiguousRecoveryWriterCallCap,
  structuralRepairCallsMaximum = 150,
  riskVerifierCallsMaximum = 150,
  hardModelCallCap = writerCallsMaximum + structuralRepairCallsMaximum + riskVerifierCallsMaximum,
  writerPromptVersion = 'editorial-writer.v1.1',
  writerPromptPath,
  writerPromptHash,
  repairPromptVersion = DEFAULT_STRUCTURAL_REPAIR_VERSION,
  repairPromptPath,
  repairPromptHash,
  verifierPromptVersion = DEFAULT_RISK_VERIFIER_VERSION,
  verifierPromptPath,
  verifierPromptHash,
  verifierSchemaPath,
  verifierSchemaHash,
  routingPolicyVersion = DEFAULT_ROUTING_POLICY_VERSION,
  promotionStates = DEFAULT_PROMOTION_STATES,
  severeAuditMissBehavior = DEFAULT_SEVERE_AUDIT_MISS_BEHAVIOR,
  authoritativeGovernance,
  plannedNamespaces = {
    writers: `execution/${trancheId.toLowerCase().replace(/_/g, '-')}/writers/<candidateId>/`,
    structuralRepairs: `execution/${trancheId.toLowerCase().replace(/_/g, '-')}/structural-repairs/<candidateId>/`,
    riskVerifiers: `execution/${trancheId.toLowerCase().replace(/_/g, '-')}/risk-verifiers/<candidateId>/`,
  },
  perCandidateSchemaBindingsHash,
}) {
  const theoreticalMaximumModelCalls = writerCallsMaximum + structuralRepairCallsMaximum + riskVerifierCallsMaximum
  if (hardModelCallCap < theoreticalMaximumModelCalls) {
    throw new Error(
      `hardModelCallCap (${hardModelCallCap}) must be at least theoreticalMaximumModelCalls (${theoreticalMaximumModelCalls})`
    )
  }
  if (expectedModelCalls >= theoreticalMaximumModelCalls) {
    throw new Error(
      `expectedModelCalls (${expectedModelCalls}) must be less than theoreticalMaximumModelCalls (${theoreticalMaximumModelCalls})`
    )
  }
  if (maxBudgetUSD < empiricalExpectedUSD) {
    throw new Error(
      `costCeilingUSD ($${maxBudgetUSD}) must be at least empiricalExpectedUSD ($${empiricalExpectedUSD})`
    )
  }

  // Compute writer call requirement accounting for reusable pilot artifacts
  const reusablePilotIds = new Set(
    (pilotReuseAudit?.records || [])
      .filter((r) => r.classification === 'REUSABLE_EXISTING_WRITER')
      .map((r) => r.candidateId)
  )
  const reusableInTranche = selectedCandidateIds.filter((id) => reusablePilotIds.has(id)).length
  const writerCallsRequired = trancheSize - reusableInTranche

  const executionPlan = {
    schemaVersion,
    trancheId,
    networkExecutionAuthorized: false,
    runtimeWritesAuthorized: false,
    cohort: {
      candidateIds: selectedCandidateIds,
      cohortManifestHash,
    },
    pilotReuseAccounting: {
      reusablePilotWriterArtifactsCount: reusableInTranche,
      freshWriterCallsRequiredCount: writerCallsRequired,
      auditRecordsEvaluated: pilotReuseAudit?.totalAudited ?? 0,
    },
    productionWriter: {
      promptVersion: writerPromptVersion,
      promptPath: writerPromptPath,
      promptHash: writerPromptHash,
      inputContractVersion: 'editorial-writer-input.v1',
      providerId: GEMINI_EDITORIAL_PROVIDER_ID,
      modelId: GEMINI_EDITORIAL_MODEL_ID,
      executionMode: 'standard-synchronous',
      thinkingLevel: THINKING_LEVELS.writer,
      maxOutputTokens: WRITER_MAX_OUTPUT_TOKENS,
      writerV2CompressionEnabled: false,
      schemaVersion: 'editorial-output.v1',
      perCandidateSchemaBindingsHash,
    },
    structuralRepair: {
      contractVersion: repairPromptVersion,
      promptPath: repairPromptPath,
      promptHash: repairPromptHash,
      maximumAttemptsPerCandidate: 1,
      reusesProductionEditorialSchema: true,
      onFailure: 'QUARANTINED',
    },
    riskVerifier: {
      contractVersion: verifierPromptVersion,
      promptPath: verifierPromptPath,
      promptHash: verifierPromptHash,
      schemaPath: verifierSchemaPath,
      schemaHash: verifierSchemaHash,
      status: 'PRODUCTION_TRANCHE_MONITORED',
      autonomousAuthority: false,
      modelExecutionBinding: 'MUST_BE_FROZEN_BEFORE_LIVE_EXECUTION',
    },
    routing: {
      policyVersion: routingPolicyVersion,
      promotionStates,
      autoEligibleIsPromotion: false,
    },
    auditPolicy: {
      auditMode: 'DETERMINISTIC_RANDOM_AUDIT',
      auditRate,
      auditAlgorithm,
      seedId: auditSeed,
      pool: 'AUTO_ELIGIBLE_ONLY',
      auditCountFormula: `ceil(autoEligibleCount * ${auditRate.toFixed(2)})`,
      operationalChoiceNotStatisticalGuarantee: true,
    },
    severeAuditMissBehavior,
    plannedNamespaces,
    liveExecutionSafety: {
      persistBeforeNetwork: true,
      normalAttemptsPerStage: 1,
      ambiguousOutcome: 'FAIL_CLOSED',
      rawResponsePreservation: true,
      terminalIdempotency: true,
      structuralRepairIsOnlyCorrectiveSecondModelCall: true,
    },
    plannedGuardrails: {
      trancheSize,
      normalWriterCallCap,
      ambiguousRecoveryWriterCallCap,
      writerCallsRequired,
      writerCallsMaximum,
      structuralRepairCallsMaximum,
      structuralRepairCallsConditionalOnly: true,
      riskVerifierCallsMaximum,
      expectedModelCalls,
      expectedModelCallsBreakdown: {
        writerCalls: writerCallsRequired,
        structuralRepairCalls: 10.5,
        structuralRepairRate: 0.07,
        riskVerifierCalls: 149.5,
        riskVerifierRate: 0.99,
      },
      theoreticalMaximumModelCalls,
      theoreticalMaximumBreakdown: {
        normalWriterCallCap,
        ambiguousRecoveryWriterCallCap,
        writerCallsMaximum,
        structuralRepairCallsMaximum,
        riskVerifierCallsMaximum,
      },
      totalExternalCallsMaximum: hardModelCallCap,
      hardModelCallCap,
      costCeilingUSD: maxBudgetUSD,
      empiricalExpectedUSD,
      pessimisticTheoreticalUSD,
      pauseAndStopRules: [
        'SEVERE_AUDIT_MISS: Immediately pause tranche and stop promotion finalization if audit fails severe criteria.',
        'UNRESOLVED_GROUNDING_CONFLICT: Candidate immediately quarantined upon unresolved conflict.',
        `CALL_CAP_REACHED: Hard model-call cap of ${hardModelCallCap} calls halts execution immediately.`,
        `BUDGET_EXCEEDED: Cost ceiling of $${maxBudgetUSD.toFixed(2)} halts execution immediately.`,
        'FAIL_CLOSED: Ambiguous responses or schema failures fail closed without mutating runtime state.',
      ],
      tokenAccountingFields: ['inputTokens', 'outputTokens', 'thinkingTokens', 'cachedInputTokens', 'totalTokens'],
      missingTokenValues: null,
      separateCallCounters: ['writerCalls', 'structuralRepairCalls', 'riskVerifierCalls', 'totalExternalCalls'],
    },
    authoritativeGovernance,
    operationAccounting: {
      externalCalls: 0,
      modelCalls: 0,
      runtimeChanges: 0,
    },
  }

  return executionPlan
}
