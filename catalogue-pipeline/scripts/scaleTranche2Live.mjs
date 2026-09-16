import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

import {
  buildEditorialGeminiSchema,
  buildGemini38Request,
  executeGemini38Structured,
  GEMINI_EDITORIAL_MODEL_ID,
  GEMINI_EDITORIAL_PROVIDER_ID,
} from '../adapters/geminiEditorialProvider.mjs'
import { buildWriterInputPacket, WRITER_MAX_OUTPUT_TOKENS } from './editorialPilot.mjs'
import { validateWriterForCritic } from './editorialPilotLive.mjs'
import { normalizeGeminiUsage } from './editorialEfficiencyAudit.mjs'
import {
  AUDIT_RATE,
  AUDIT_SEED_ID,
  COST_CEILING_USD,
  HARD_MODEL_CALL_CAP,
  outputRoot,
  PRIOR_DEFERRED_ID,
  THEORETICAL_MAXIMUM_MODEL_CALLS,
  TRANCHE_ID,
  TRANCHE_SIZE,
} from './scaleTranche2Plan.mjs'
import { hashArtifact, hashBytes, serializeArtifactForPersistence } from './validatePromotionContract.mjs'
import { validateVerifierSemanticPayload } from './reconcileScaleTranche1Verifier.mjs'

export const NORMAL_WRITER_CALL_CAP = TRANCHE_SIZE
export const AMBIGUOUS_RECOVERY_WRITER_CALL_CAP = 1
export const EFFECTIVE_WRITER_CALL_CAP = NORMAL_WRITER_CALL_CAP + AMBIGUOUS_RECOVERY_WRITER_CALL_CAP
export const STRUCTURAL_REPAIR_CALL_CAP = TRANCHE_SIZE
export const RISK_VERIFIER_CALL_CAP = TRANCHE_SIZE
export { HARD_MODEL_CALL_CAP, THEORETICAL_MAXIMUM_MODEL_CALLS }

export const LIVE_USD_CEILING = COST_CEILING_USD
export const LIVE_CALL_CAPS = Object.freeze({
  writerCalls: EFFECTIVE_WRITER_CALL_CAP,
  structuralRepairCalls: STRUCTURAL_REPAIR_CALL_CAP,
  riskVerifierCalls: RISK_VERIFIER_CALL_CAP,
  totalExternalCalls: HARD_MODEL_CALL_CAP,
})

export const CANARY_SEED_ID = 'movie-mood-v8.2-scale-tranche-2-live-canary-v1'
export const CANARY_SIZE = 10
export const BLIND_SEED_ID = 'movie-mood-v8.2-scale-tranche-2-human-review-v1'
export const SHUFFLE_ALGORITHM = 'SHA256(seed + candidateId) ASCENDING_LEXICOGRAPHIC'

export const RISK_VERIFIER_LIVE_BINDING = Object.freeze({
  contractVersion: 'source-boundary-risk-verifier.v1.1',
  providerId: GEMINI_EDITORIAL_PROVIDER_ID,
  modelId: GEMINI_EDITORIAL_MODEL_ID,
  executionMode: 'standard-synchronous',
  thinkingLevel: 'medium',
  maxOutputTokens: 4096,
  status: 'PRODUCTION_TRANCHE_MONITORED',
  autonomousAuthority: false,
})

export const PRODUCTION_WRITER_LIVE_BINDING = Object.freeze({
  promptVersion: 'editorial-writer.v1.1',
  providerId: GEMINI_EDITORIAL_PROVIDER_ID,
  modelId: GEMINI_EDITORIAL_MODEL_ID,
  executionMode: 'standard-synchronous',
  thinkingLevel: 'low',
  maxOutputTokens: 8192,
})

export const EXPECTED_BINDINGS = Object.freeze({
  trancheId: TRANCHE_ID,
  trancheSize: TRANCHE_SIZE,
  cohortHash: 'sha256:5fe3464685f5a1c8217bf7b06f74dd49f2ccf4f720ffe2ce345a7bee1b2e6e54',
  orderedCandidateIdsHash: 'sha256:022d1cb16446af37f1d62c8bd3e257352cf9298436a747f1e15a9eedc6b25a44',
  executionPlanHash: 'sha256:5091b0b7c738b22fd1f440e4521714a9a31c9d2e9548f5e9ff7fba9778785828',
  remainingAccountingHash: 'sha256:aca445ebd3d8b0b1b4524c123f2e3f20db25ea98f6fe9521395887366b1d9b2d',
  pilotReuseAuditHash: 'sha256:e0f46913d49f3a098466016b7fd240ae808e3700401469ea9d5b0096209e58b7',
  writerPromptHash: 'sha256:743da4506a93a1d82509992acc9d46a3e4b22f4152106a62fdab997a1fba2169',
  writerSchemaBindingsHash: 'sha256:2758e76ee3b448a5808c19bae5f416c73efd241b0d989b9ed03cd9adb6c6db4c',
  repairPromptHash: 'sha256:139a19b4a72e09f6cd640e4de424fa9323e1c455a5730127877bf3ed737c0a3b',
  verifierPromptHash: 'sha256:361df6c2f5ca6feb3567c092e3f7bc5de7396f48b52e7a6c8afc9dbf00768123',
  verifierSchemaHash: 'sha256:9e0647d3753e482ad23780725020f6bebb408486ba663596c0bb0fe562b06120',
  governanceHash: 'sha256:7d6a46d3fde76f4bd578fb17a168f5c87fa65c2fb2d25519fb5d88b72886a43e',
})

const root = (repoRoot) => outputRoot(repoRoot)
const executionRoot = (repoRoot) => path.join(root(repoRoot), 'execution/scale-tranche-2')
const ledgerPath = (repoRoot) => path.join(root(repoRoot), 'live-execution-ledger.json')
const readJson = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'))
const relative = (repoRoot, filePath) => path.relative(repoRoot, filePath).split(path.sep).join('/')
const canonical = async (filePath, value) => {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, serializeArtifactForPersistence(value))
}
const raw = async (filePath, value) => {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, value)
}

const emptyUsage = () => ({
  inputTokens: null,
  outputTokens: null,
  thinkingTokens: null,
  cachedInputTokens: null,
  totalTokens: null,
})

const TERMINAL = new Set(['COMPLETE', 'WRITER_UNAVAILABLE', 'STRUCTURAL_QUARANTINED', 'VERIFIER_UNAVAILABLE'])

export const PIPELINE_STAGES = Object.freeze(['writer', 'structuralRepair', 'riskVerifier'])

export function getUnresolvedPersistedDispatchStage(record) {
  if (!record || TERMINAL.has(record.terminalState)) return null
  for (const stage of PIPELINE_STAGES) {
    const stageObj = record[stage]
    if (
      stageObj?.dispatch?.occurred === true &&
      stageObj?.dispatch?.responseReceived === false &&
      !['VALID', 'INVALID', 'UNAVAILABLE', 'QUOTA_BLOCKED'].includes(stageObj.terminalState)
    ) {
      return stage
    }
  }
  return null
}

export function isUnresolvedPersistedDispatch(record, ledger = null) {
  return getUnresolvedPersistedDispatchStage(record) !== null
}

export function getAmbiguousRecoveryStatus(record, ledger = null) {
  if (!record) {
    return {
      candidateId: null,
      isUnresolved: false,
      recoverable: false,
      stage: null,
      recoveryAttemptsUsed: 0,
      recoveryAttemptsRemaining: 0,
      reason: 'CANDIDATE_NOT_FOUND',
    }
  }

  const stage = getUnresolvedPersistedDispatchStage(record)
  const isUnresolved = stage !== null
  const recoveryAttemptsUsed = record.ambiguousDispatchRecovery?.recoveryAttempt ?? 0
  const maxAttempts = 1
  const recoveryAttemptsRemaining = Math.max(0, maxAttempts - recoveryAttemptsUsed)
  const recoverable = isUnresolved && recoveryAttemptsRemaining > 0

  let reason = 'OK'
  if (!isUnresolved) {
    if (TERMINAL.has(record.terminalState)) {
      reason = 'CANDIDATE_ALREADY_TERMINAL'
    } else if (PIPELINE_STAGES.some((s) => record[s]?.dispatch?.responseReceived === true)) {
      reason = 'RESPONSE_ALREADY_RECEIVED'
    } else if (!PIPELINE_STAGES.some((s) => record[s]?.dispatch?.occurred === true)) {
      reason = 'NO_DISPATCH_OCCURRED'
    } else {
      reason = 'NOT_IN_UNRESOLVED_DISPATCH_STATE'
    }
  } else if (recoveryAttemptsRemaining <= 0) {
    reason = 'AMBIGUOUS_RECOVERY_ATTEMPTS_EXHAUSTED'
  }

  return {
    candidateId: record.candidateId,
    isUnresolved,
    recoverable,
    stage,
    recoveryAttemptsUsed,
    recoveryAttemptsRemaining,
    reason,
  }
}

const FORBIDDEN_REVIEWER_KEYS = new Set([
  'routingStatus',
  'promotionState',
  'reviewReasons',
  'riskLevel',
  'riskCategories',
  'issues',
  'verifierIssue',
  'auditMembership',
  'reconciliationEligibility',
  'criticOutput',
  'modelCost',
  'tokenUsage',
  'providerProvenanceClass',
  'selectionRationale',
])

export function seededKey(seedId, candidateId) {
  if (!seedId || typeof seedId !== 'string') throw new Error('seedId must be a non-empty string')
  if (!candidateId || typeof candidateId !== 'string') throw new Error('candidateId must be a non-empty string')
  return createHash('sha256').update(`${seedId}|${candidateId}`).digest('hex')
}

export function selectCanaryCandidateIds(candidateIds, count = CANARY_SIZE, seedId = CANARY_SEED_ID) {
  return [...candidateIds]
    .sort((a, b) => seededKey(seedId, a).localeCompare(seededKey(seedId, b)))
    .slice(0, count)
}

export function selectAuditCandidateIds(autoEligibleCandidateIds, seedId = AUDIT_SEED_ID, auditRate = AUDIT_RATE) {
  const unique = [...new Set(autoEligibleCandidateIds)]
  if (unique.length !== autoEligibleCandidateIds.length) throw new Error('Audit pool contains duplicate candidate IDs')
  const auditCount = Math.ceil(unique.length * auditRate)
  const selected = unique
    .slice()
    .sort((a, b) => seededKey(seedId, a).localeCompare(seededKey(seedId, b)))
    .slice(0, auditCount)
  return {
    auditAlgorithm: 'sha256-lexicographic.v1',
    seedId,
    eligiblePoolCount: unique.length,
    auditRate,
    auditCount,
    orderedAuditCandidateIdsHash: hashArtifact(selected),
    candidateIds: selected,
  }
}

export function deterministicBlindOrder(candidateIds, seedId = BLIND_SEED_ID) {
  return [...candidateIds]
    .sort((a, b) => seededKey(seedId, a).localeCompare(seededKey(seedId, b)))
}

export function buildRiskVerifierInput({ writerPacket, visibleEditorialCopy }) {
  return {
    facts: writerPacket.facts,
    acceptedSemanticClassification: writerPacket.acceptedSemanticClassification,
    semanticBoundaryFlags: writerPacket.semanticBoundaryFlags,
    allowedSourceMaterial: writerPacket.allowedSourceMaterial,
    spoilerBoundaryRules: writerPacket.spoilerBoundaryRules,
    copyConstraints: writerPacket.copyConstraints,
    visibleEditorialCopy,
  }
}

export function providerVerifierSchema(schema) {
  const projected = structuredClone(schema)
  for (const key of ['$schema', '$id', 'title', 'description', 'x-deterministicConsistencyRules']) {
    delete projected[key]
  }
  return projected
}

export function routeProductionRecord({
  structuralValidation,
  structuralRepairOutcome,
  provenanceCompleteness,
  riskVerifierResult,
  productionValidation,
  unresolvedSourceGroundingConflict = false,
}) {
  if (structuralRepairOutcome === 'FAILED' || productionValidation === 'UNSAFE_TO_EVALUATE') {
    return { riskRoutingStatus: 'QUARANTINED', promotionAuthorized: false }
  }
  if (riskVerifierResult === 'HIGH_RISK' || unresolvedSourceGroundingConflict) {
    return { riskRoutingStatus: 'HUMAN_REVIEW_REQUIRED', promotionAuthorized: false }
  }
  const structuralPass = structuralValidation === 'PASS' || structuralRepairOutcome === 'PASS'
  if (structuralPass && provenanceCompleteness === 'COMPLETE' && riskVerifierResult === 'LOW_RISK' && productionValidation === 'PASS') {
    return { riskRoutingStatus: 'AUTO_ELIGIBLE', promotionAuthorized: false }
  }
  return { riskRoutingStatus: 'QUARANTINED', promotionAuthorized: false }
}

function estimateCost(usage, pricing) {
  if (usage.inputTokens == null || usage.outputTokens == null) return null
  const input = (usage.inputTokens / 1e6) * pricing.pricesPerMillionTokens.standard.input
  const output = ((usage.outputTokens + (usage.thinkingTokens ?? 0)) / 1e6) * pricing.pricesPerMillionTokens.standard.outputIncludingThinking
  return {
    currency: 'USD',
    input,
    outputIncludingThinking: output,
    total: input + output,
    pricingVerifiedAt: pricing.verifiedAt,
  }
}

function sumUsage(records, stage) {
  const result = emptyUsage()
  for (const key of Object.keys(result)) {
    const values = records.map((record) => record[stage]?.usage?.[key]).filter((value) => typeof value === 'number')
    result[key] = values.length ? values.reduce((sum, value) => sum + value, 0) : null
  }
  return result
}

function summarize(ledger) {
  const records = ledger.records
  ledger.accounting = {
    writerCalls: ledger.callCounts.writerCalls,
    structuralRepairCalls: ledger.callCounts.structuralRepairCalls,
    riskVerifierCalls: ledger.callCounts.riskVerifierCalls,
    totalExternalCalls: ledger.callCounts.totalExternalCalls,
    writerTokens: sumUsage(records, 'writer'),
    structuralRepairTokens: sumUsage(records, 'structuralRepair'),
    riskVerifierTokens: sumUsage(records, 'riskVerifier'),
    writerEstimatedUSD: records.reduce((sum, record) => sum + (record.writer?.estimatedCost?.total ?? 0), 0),
    structuralRepairEstimatedUSD: records.reduce((sum, record) => sum + (record.structuralRepair?.estimatedCost?.total ?? 0), 0),
    riskVerifierEstimatedUSD: records.reduce((sum, record) => sum + (record.riskVerifier?.estimatedCost?.total ?? 0), 0),
  }
  ledger.accounting.totalEstimatedUSD =
    ledger.accounting.writerEstimatedUSD +
    ledger.accounting.structuralRepairEstimatedUSD +
    ledger.accounting.riskVerifierEstimatedUSD
  return ledger
}

export function assertCanDispatch(ledger, stage, record = null) {
  summarize(ledger)
  if (ledger.accounting.totalEstimatedUSD >= LIVE_USD_CEILING) {
    throw Object.assign(new Error(`USD ceiling reached before dispatch: $${ledger.accounting.totalEstimatedUSD.toFixed(4)} >= $${LIVE_USD_CEILING.toFixed(2)}`), {
      code: 'USD_CEILING_REACHED',
      stop: true,
    })
  }
  if (ledger.callCounts.totalExternalCalls >= LIVE_CALL_CAPS.totalExternalCalls) {
    throw Object.assign(new Error(`Call ceiling reached for totalExternalCalls: ${ledger.callCounts.totalExternalCalls}/${LIVE_CALL_CAPS.totalExternalCalls}`), {
      code: 'CALL_CEILING_REACHED',
      stop: true,
    })
  }

  if (stage === 'writerCalls') {
    if (ledger.callCounts.writerCalls >= EFFECTIVE_WRITER_CALL_CAP) {
      throw Object.assign(new Error(`Call ceiling reached for writerCalls: ${ledger.callCounts.writerCalls}/${EFFECTIVE_WRITER_CALL_CAP}`), {
        code: 'CALL_CEILING_REACHED',
        stop: true,
      })
    }

    const recoveryCallsUsed = ledger.records?.filter((r) => r.ambiguousDispatchRecovery?.recoveryAttempt >= 1).length ?? 0
    const normalWriterCallsUsed = Math.max(0, ledger.callCounts.writerCalls - recoveryCallsUsed)

    const isRecoveryDispatch = record?.ambiguousDispatchRecovery?.stage === 'writer'

    if (isRecoveryDispatch) {
      if (!record.ambiguousDispatchRecovery.recoveryAuthorized) {
        throw Object.assign(new Error('Unauthorized ambiguous recovery attempt'), {
          code: 'CALL_CEILING_REACHED',
          stop: true,
        })
      }
      if (record.ambiguousDispatchRecovery.recoveryAttempt > record.ambiguousDispatchRecovery.maxRecoveryAttempts) {
        throw Object.assign(new Error('Call ceiling reached for ambiguous recovery calls: second recovery is forbidden'), {
          code: 'CALL_CEILING_REACHED',
          stop: true,
        })
      }
      if (recoveryCallsUsed > AMBIGUOUS_RECOVERY_WRITER_CALL_CAP) {
        throw Object.assign(new Error(`Call ceiling reached for ambiguous recovery calls: ${recoveryCallsUsed}/${AMBIGUOUS_RECOVERY_WRITER_CALL_CAP}`), {
          code: 'CALL_CEILING_REACHED',
          stop: true,
        })
      }
    } else {
      if (normalWriterCallsUsed >= NORMAL_WRITER_CALL_CAP) {
        throw Object.assign(new Error(`Call ceiling reached for normal writer calls: ${normalWriterCallsUsed}/${NORMAL_WRITER_CALL_CAP}`), {
          code: 'CALL_CEILING_REACHED',
          stop: true,
        })
      }
    }
  } else {
    if (ledger.callCounts[stage] >= LIVE_CALL_CAPS[stage]) {
      throw Object.assign(new Error(`Call ceiling reached for ${stage}: ${ledger.callCounts[stage]}/${LIVE_CALL_CAPS[stage]}`), {
        code: 'CALL_CEILING_REACHED',
        stop: true,
      })
    }
  }
}

export function isGlobalStop(error, ledger) {
  if (error?.ambiguous || error?.status === 429 || error?.category === 'configuration') return true
  if ([500, 502, 503, 504].includes(error?.status)) {
    ledger.responseBearing5xx = (ledger.responseBearing5xx || 0) + 1
    return ledger.responseBearing5xx >= 2
  }
  return false
}

function errorData(error) {
  return {
    code: error.code ?? 'UNEXPECTED_ERROR',
    category: error.category ?? 'unknown',
    status: error.status ?? null,
    message: error.message,
    ambiguous: Boolean(error.ambiguous),
  }
}

function repairable(validation) {
  const forbidden = new Set([
    'WRITER_IDENTITY_MISMATCH',
    'WRITER_SOURCE_REF_UNAUTHORIZED',
    'MODEL_OR_META_LANGUAGE',
    'PLACEHOLDER_COPY',
  ])
  return (
    validation.hardFailures.length > 0 &&
    validation.hardFailures.every((failure) => !forbidden.has(failure.code))
  )
}

async function dispatchStage({
  repoRoot,
  ledger,
  record,
  stage,
  input,
  promptText,
  schema,
  thinkingLevel,
  maxOutputTokens,
  pricing,
  apiKey,
  fetchImpl,
  validateOutput,
}) {
  const targetLedgerPath = ledger.__filePath || ledgerPath(repoRoot)
  assertCanDispatch(ledger, `${stage}Calls`, record)
  const request = buildGemini38Request({ promptText, input, responseSchema: schema, thinkingLevel, maxOutputTokens })
  const stageDirName = stage === 'writer' ? 'writers' : stage === 'structuralRepair' ? 'structural-repairs' : 'risk-verifiers'
  const dir = path.join(executionRoot(repoRoot), stageDirName, record.candidateId)

  const result = {
    request: request.requestMetadata,
    promptHash: hashBytes(promptText),
    schemaHash: hashArtifact(schema),
    providerId: GEMINI_EDITORIAL_PROVIDER_ID,
    modelId: GEMINI_EDITORIAL_MODEL_ID,
    thinkingLevel,
    maxOutputTokens,
    dispatch: { occurred: false, responseReceived: false, rawResponsePreserved: false, ambiguous: false },
    attempts: [],
    usage: emptyUsage(),
    estimatedCost: null,
    terminalState: 'DISPATCH_PENDING',
  }
  record[stage] = result
  await canonical(targetLedgerPath, summarize(ledger))

  try {
    const response = await executeGemini38Structured({
      apiKey,
      request,
      fetchImpl,
      maxAttempts: 1,
      validateOutput: () => ({ ok: true }),
      onDispatch: async () => {
        result.dispatch.occurred = true
        result.terminalState = 'DISPATCHED'
        ledger.callCounts[`${stage}Calls`] += 1
        ledger.callCounts.totalExternalCalls += 1
        await canonical(targetLedgerPath, summarize(ledger))
      },
      preserveRawResponse: async ({ attempt, status, rawText, rawResponseHash }) => {
        const filePath = path.join(dir, `raw-response.attempt-${String(attempt).padStart(2, '0')}.json`)
        await raw(filePath, rawText)
        result.attempts.push({ attempt, status, rawResponsePath: relative(repoRoot, filePath), rawResponseHash })
        result.dispatch.responseReceived = true
        result.dispatch.rawResponsePreserved = true
      },
    })
    result.usageMetadata = response.usageMetadata
    result.usage = normalizeGeminiUsage(response.usageMetadata)
    result.estimatedCost = estimateCost(result.usage, pricing)
    result.validation = validateOutput(response.output)
    const outputPath = path.join(dir, 'output.json')
    await canonical(outputPath, response.output)
    result.outputPath = relative(repoRoot, outputPath)
    result.outputHash = hashArtifact(response.output)
    result.output = response.output
    result.terminalState = result.validation.ok ? 'VALID' : 'INVALID'
  } catch (error) {
    result.error = errorData(error)
    result.dispatch.ambiguous = Boolean(error.ambiguous)
    result.terminalState = error.ambiguous ? 'AMBIGUOUS' : error.status === 429 ? 'QUOTA_BLOCKED' : 'UNAVAILABLE'
    if (isGlobalStop(error, ledger)) {
      ledger.stop = { code: result.error.code, stage, candidateId: record.candidateId }
    }
  }

  await canonical(path.join(dir, 'result.json'), { ...result, output: undefined })
  await canonical(targetLedgerPath, summarize(ledger))
  return result
}

async function sourcePacket(repoRoot, cohortRecord, voiceGuideBinding) {
  const source = cohortRecord.sourceBindings
  const [semanticArtifact, evidencePacket, expansionFacts, scaleFacts] = await Promise.all([
    readJson(path.join(repoRoot, source.semanticArtifact.path)),
    readJson(path.join(repoRoot, source.evidencePacket.path)),
    readJson(path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-expansion/expansion-100-v1/factual-snapshot.json')),
    readJson(path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-expansion/scale-500-v1/factual-snapshot.json')),
  ])
  const facts = [...expansionFacts.facts, ...scaleFacts.facts].find((entry) => entry.candidateId === cohortRecord.candidateId)
  const sourceBindings = {
    semanticArtifact: {
      path: source.semanticArtifact.path,
      historicalSourceHash: source.semanticArtifact.historicalSourceHash,
      v8_2ArtifactHash: source.semanticArtifact.artifactHash,
    },
    evidencePacket: {
      path: source.evidencePacket.path,
      historicalSourceHash: source.evidencePacket.historicalSourceHash,
      v8_2ArtifactHash: source.evidencePacket.artifactHash,
    },
    factsRecord: {
      path: source.factsRecord.path,
      historicalSourceHash: source.factsRecord.historicalSourceHash,
      v8_2ArtifactHash: source.factsRecord.artifactHash,
    },
  }
  return buildWriterInputPacket({
    pilotEntry: { candidateId: cohortRecord.candidateId, tmdbId: cohortRecord.tmdbId },
    factsRecord: facts,
    semanticArtifact,
    evidencePacket,
    sourceBindings,
    voiceGuideBinding,
  })
}

export async function preflightScaleTranche2Live({ repoRoot, customLedgerPath = null } = {}) {
  const outDir = root(repoRoot)
  const cohortPath = path.join(outDir, 'cohort-manifest.json')
  const planPath = path.join(outDir, 'execution-plan.json')
  const accountingPath = path.join(outDir, 'remaining-catalogue-accounting.json')
  const pilotAuditPath = path.join(outDir, 'pilot-reuse-audit.json')

  const [cohort, plan, accounting, pilotAudit, t1Cohort] = await Promise.all([
    readJson(cohortPath),
    readJson(planPath),
    readJson(accountingPath),
    readJson(pilotAuditPath),
    readJson(path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/cohort-manifest.json')),
  ])

  // 1. Check frozen artifact hashes
  if (hashArtifact(cohort) !== EXPECTED_BINDINGS.cohortHash) throw new Error('Cohort manifest hash mismatch')
  if (cohort.orderedCandidateIdsHash !== EXPECTED_BINDINGS.orderedCandidateIdsHash) throw new Error('Cohort ordered candidate IDs hash mismatch')
  if (hashArtifact(plan) !== EXPECTED_BINDINGS.executionPlanHash) throw new Error('Execution plan hash mismatch')
  if (hashArtifact(accounting) !== EXPECTED_BINDINGS.remainingAccountingHash) throw new Error('Remaining accounting hash mismatch')
  if (hashArtifact(pilotAudit) !== EXPECTED_BINDINGS.pilotReuseAuditHash) throw new Error('Pilot reuse audit hash mismatch')

  // 2. Cardinality and uniqueness
  if (cohort.records.length !== TRANCHE_SIZE || new Set(cohort.records.map((r) => r.candidateId)).size !== TRANCHE_SIZE) {
    throw new Error(`Cohort cardinality mismatch: expected ${TRANCHE_SIZE} unique candidates, got ${cohort.records.length}`)
  }
  if (new Set(cohort.records.map((r) => r.tmdbId)).size !== TRANCHE_SIZE) {
    throw new Error('Cohort contains duplicate TMDB IDs')
  }

  // 3. Zero overlap with T1
  const t1Set = new Set(t1Cohort.records.map((r) => r.candidateId))
  for (const r of cohort.records) {
    if (t1Set.has(r.candidateId)) throw new Error(`T1 overlap detected: candidate ${r.candidateId} in both T1 and T2`)
  }

  // 4. Deferred candidate strictly absent
  if (cohort.records.some((r) => r.candidateId === PRIOR_DEFERRED_ID)) {
    throw new Error(`Deferred candidate ${PRIOR_DEFERRED_ID} present in T2 cohort`)
  }

  // 5. Prompt & contract bindings
  const [writerPrompt, repairPrompt, verifierPromptV11, verifierSchemaV11, governance] = await Promise.all([
    readFile(path.join(repoRoot, 'catalogue-pipeline/prompts/editorial-writer.v1.1.md'), 'utf8'),
    readFile(path.join(repoRoot, 'catalogue-pipeline/prompts/editorial-structural-repair.v1.md'), 'utf8'),
    readFile(path.join(repoRoot, 'catalogue-pipeline/prompts/source-boundary-risk-verifier.v1.1.md'), 'utf8'),
    readJson(path.join(repoRoot, 'catalogue-pipeline/schemas/source-boundary-risk-verifier.v1.1.schema.json')),
    readJson(path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/review/v8-2-scalable-promotion-governance.v1.json')),
  ])

  if (hashBytes(writerPrompt) !== EXPECTED_BINDINGS.writerPromptHash) throw new Error('Writer prompt hash mismatch')
  if (hashBytes(repairPrompt) !== EXPECTED_BINDINGS.repairPromptHash) throw new Error('Structural repair prompt hash mismatch')
  if (hashBytes(verifierPromptV11) !== EXPECTED_BINDINGS.verifierPromptHash) throw new Error('Verifier v1.1 prompt hash mismatch')
  if (hashArtifact(verifierSchemaV11) !== EXPECTED_BINDINGS.verifierSchemaHash) throw new Error('Verifier v1.1 schema hash mismatch')
  if (hashArtifact(governance) !== EXPECTED_BINDINGS.governanceHash) throw new Error('Governance artifact hash mismatch')

  // 6. Source bindings resolution and freshness
  for (const record of cohort.records) {
    for (const binding of Object.values(record.sourceBindings)) {
      const value = await readJson(path.join(repoRoot, binding.path))
      if (binding === record.sourceBindings.factsRecord) {
        const facts = value.facts.find((entry) => entry.candidateId === record.candidateId)
        if (!facts || hashArtifact(facts) !== binding.artifactHash) {
          throw new Error(`Facts binding mismatch for candidate: ${record.candidateId}`)
        }
      } else if (hashArtifact(value) !== binding.artifactHash) {
        throw new Error(`Source binding mismatch for candidate: ${record.candidateId}`)
      }
    }
  }

  // 7. Guardrails verification
  if (plan.plannedGuardrails.costCeilingUSD !== COST_CEILING_USD) throw new Error('Cost ceiling mismatch')
  if (plan.plannedGuardrails.hardModelCallCap !== HARD_MODEL_CALL_CAP) throw new Error('Hard model call cap mismatch')
  if (plan.runtimeWritesAuthorized !== false) throw new Error('Runtime writes must be forbidden in execution plan')

  const canaryCandidateIds = selectCanaryCandidateIds(cohort.records.map((r) => r.candidateId))

  // 8. Live ledger inspection (read-only, zero-mutation)
  let liveLedgerInspection = null
  const currentLedgerPath = customLedgerPath || ledgerPath(repoRoot)
  if (existsSync(currentLedgerPath)) {
    try {
      const liveLedger = await readJson(currentLedgerPath)
      const unresolvedCandidate = liveLedger.records?.find((r) => isUnresolvedPersistedDispatch(r, liveLedger))

      const recoveryCallsUsed = liveLedger.records?.filter((r) => r.ambiguousDispatchRecovery?.recoveryAttempt >= 1).length ?? 0
      const writerCalls = liveLedger.callCounts?.writerCalls ?? 0
      const normalWriterCallsConsumed = Math.max(0, writerCalls - recoveryCallsUsed)
      const totalExternalCalls = liveLedger.callCounts?.totalExternalCalls ?? 0
      const writerCallsRemaining = Math.max(0, EFFECTIVE_WRITER_CALL_CAP - writerCalls)

      const remainingCandidates = liveLedger.records?.filter((r) => r.terminalState === 'PENDING').length ?? 0
      const remainingNormalCandidates = Math.max(0, NORMAL_WRITER_CALL_CAP - normalWriterCallsConsumed)

      const resumePermitted = (
        !unresolvedCandidate &&
        writerCallsRemaining > 0 &&
        normalWriterCallsConsumed < NORMAL_WRITER_CALL_CAP &&
        totalExternalCalls < HARD_MODEL_CALL_CAP &&
        (liveLedger.accounting?.totalEstimatedUSD ?? 0) < LIVE_USD_CEILING &&
        remainingCandidates > 0
      )

      if (unresolvedCandidate) {
        const recoveryStatus = getAmbiguousRecoveryStatus(unresolvedCandidate, liveLedger)
        liveLedgerInspection = {
          status: liveLedger.status,
          stop: liveLedger.stop,
          candidateId: unresolvedCandidate.candidateId,
          stage: recoveryStatus.stage,
          recoverableAmbiguousDispatch: recoveryStatus.recoverable,
          recoveryAttemptsUsed: recoveryStatus.recoveryAttemptsUsed,
          recoveryAttemptsRemaining: recoveryStatus.recoveryAttemptsRemaining,
          reason: recoveryStatus.reason,
          normalWriterCallCap: NORMAL_WRITER_CALL_CAP,
          ambiguousRecoveryCallsAuthorized: AMBIGUOUS_RECOVERY_WRITER_CALL_CAP,
          ambiguousRecoveryCallsUsed: recoveryCallsUsed,
          effectiveWriterCallCap: EFFECTIVE_WRITER_CALL_CAP,
          writerCalls,
          normalWriterCallsConsumed,
          recoveryWriterCallsConsumed: recoveryCallsUsed,
          writerCallsRemaining,
          totalExternalCalls,
          hardModelCallCap: HARD_MODEL_CALL_CAP,
          remainingCandidates,
          remainingNormalCandidates,
          resumePermitted: false,
        }
      } else {
        liveLedgerInspection = {
          status: liveLedger.status,
          stop: liveLedger.stop,
          candidateId: null,
          recoverableAmbiguousDispatch: false,
          recoveryAttemptsUsed: recoveryCallsUsed,
          recoveryAttemptsRemaining: Math.max(0, AMBIGUOUS_RECOVERY_WRITER_CALL_CAP - recoveryCallsUsed),
          normalWriterCallCap: NORMAL_WRITER_CALL_CAP,
          ambiguousRecoveryCallsAuthorized: AMBIGUOUS_RECOVERY_WRITER_CALL_CAP,
          ambiguousRecoveryCallsUsed: recoveryCallsUsed,
          effectiveWriterCallCap: EFFECTIVE_WRITER_CALL_CAP,
          writerCalls,
          normalWriterCallsConsumed,
          recoveryWriterCallsConsumed: recoveryCallsUsed,
          writerCallsRemaining,
          totalExternalCalls,
          hardModelCallCap: HARD_MODEL_CALL_CAP,
          remainingCandidates,
          remainingNormalCandidates,
          resumePermitted,
        }
      }
    } catch {}
  }

  return {
    ok: true,
    cohort,
    plan,
    accounting,
    pilotAudit,
    canaryCandidateIds,
    externalCalls: 0,
    liveLedgerInspection,
  }
}

function collectForbiddenKeys(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectForbiddenKeys(item, found)
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_REVIEWER_KEYS.has(key)) found.push(key)
      collectForbiddenKeys(child, found)
    }
  }
  return found
}

export function buildBlindPackets({ queueRecords, routingRecords, riskInputs, orderedCandidateIds }) {
  const routingById = new Map(routingRecords.map((r) => [r.candidateId, r]))
  const queueById = new Map(queueRecords.map((r) => [r.candidateId, r]))
  const records = []

  for (const [index, candidateId] of orderedCandidateIds.entries()) {
    const queueRecord = queueById.get(candidateId)
    const routingRecord = routingById.get(candidateId)
    const riskInput = riskInputs.get(candidateId)
    if (!queueRecord || !routingRecord || !riskInput) {
      throw new Error(`Incomplete blind packet source for candidate: ${candidateId}`)
    }
    records.push({
      blindOrdinal: index + 1,
      candidateId: queueRecord.candidateId,
      tmdbId: queueRecord.tmdbId,
      title: riskInput.facts.title,
      facts: riskInput.facts,
      acceptedSemanticClassification: riskInput.acceptedSemanticClassification,
      semanticBoundaryFlags: riskInput.semanticBoundaryFlags,
      allowedSourceMaterial: riskInput.allowedSourceMaterial,
      spoilerBoundaryRules: riskInput.spoilerBoundaryRules,
      copyConstraints: riskInput.copyConstraints,
      visibleEditorialCopy: riskInput.visibleEditorialCopy,
    })
  }

  const packet = {
    schemaVersion: 'scale-tranche-2-human-review-blind-packets.v1',
    trancheId: TRANCHE_ID,
    seedId: BLIND_SEED_ID,
    shuffleAlgorithm: SHUFFLE_ALGORITHM,
    orderedCandidateIdsHash: hashArtifact(orderedCandidateIds),
    recordCount: records.length,
    reviewStandard: {
      id: 'A_PRIME_SOURCE_BOUNDARY_V1',
      principle:
        'Atmosphere, genre register, metaphorical urgency, and viewing-experience inference are acceptable when they do not assert new concrete story facts. Plot events, motives, relationships, identities, mechanisms, franchise history, comparative claims, and scene-specific details require support in the authorized packet. External truth alone does not authorize a detail.',
      purpose: 'VIEWER_TRUST_AND_EXPECTATION_CALIBRATION_NOT_WORD_FOR_WORD_PARAPHRASE',
    },
    records,
  }

  const forbidden = collectForbiddenKeys(records)
  if (forbidden.length) throw new Error(`Forbidden reviewer keys leaked: ${[...new Set(forbidden)].sort().join(',')}`)
  return packet
}

export function buildRoutingManifest(ledger, frozenBindings) {
  const records = ledger.records.map((record) => ({
    candidateId: record.candidateId,
    tmdbId: record.tmdbId,
    writerOutcome: record.writer?.terminalState ?? 'NOT_RUN',
    writerArtifactPath: record.writer?.artifactPath ?? null,
    writerArtifactHash: record.writer?.artifactHash ?? null,
    structuralValidation: record.structuralValidation ?? null,
    structuralRepair: record.structuralRepairStatus ?? 'NOT_REQUIRED',
    finalEditorialArtifactPath: record.finalEditorialArtifactPath ?? null,
    finalEditorialArtifactHash: record.finalEditorialArtifactHash ?? null,
    riskVerifierOutcome: record.riskVerifier?.terminalState ?? 'NOT_RUN',
    riskLevel: record.riskVerifier?.output?.riskLevel ?? null,
    riskCategories: record.riskVerifier?.output?.riskCategories ?? [],
    issues: record.riskVerifier?.output?.issues ?? [],
    productionValidation: record.productionValidation ?? null,
    routingStatus: record.routingStatus,
    promotionState: record.promotionState,
    tokenAccounting: {
      writer: record.writer?.usage ?? emptyUsage(),
      structuralRepair: record.structuralRepair?.usage ?? emptyUsage(),
      riskVerifier: record.riskVerifier?.usage ?? emptyUsage(),
    },
    estimatedCosts: {
      writerUSD: record.writer?.estimatedCost?.total ?? null,
      structuralRepairUSD: record.structuralRepair?.estimatedCost?.total ?? null,
      riskVerifierUSD: record.riskVerifier?.estimatedCost?.total ?? null,
    },
  }))
  const count = (predicate) => records.filter(predicate).length
  return {
    schemaVersion: 'scale-tranche-2-routing-manifest.v1',
    trancheId: TRANCHE_ID,
    noCandidatePromotionEligible: true,
    frozenBindings,
    records,
    aggregate: {
      totalCandidates: records.length,
      writerValid: count((r) => r.writerOutcome === 'VALID'),
      writerStructuralFailures: count((r) => r.structuralValidation === 'FAIL'),
      repairAttempted: count((r) => r.structuralRepair !== 'NOT_REQUIRED'),
      repairSucceeded: count((r) => r.structuralRepair === 'REPAIRED'),
      repairFailed: count((r) => r.structuralRepair === 'FAILED'),
      verifierLowRisk: count((r) => r.riskVerifierOutcome === 'VALID' && r.riskLevel === 'LOW_RISK'),
      verifierHighRisk: count((r) => r.riskVerifierOutcome === 'VALID' && r.riskLevel === 'HIGH_RISK'),
      verifierInvalidOrUnavailable: count((r) =>
        ['INVALID', 'UNAVAILABLE', 'QUOTA_BLOCKED', 'AMBIGUOUS'].includes(r.riskVerifierOutcome)
      ),
      autoEligible: count((r) => r.routingStatus === 'AUTO_ELIGIBLE'),
      humanReviewRequired: count((r) => r.routingStatus === 'HUMAN_REVIEW_REQUIRED'),
      quarantined: count((r) => r.routingStatus === 'QUARANTINED'),
    },
    accounting: ledger.accounting,
  }
}

export async function runScaleTranche2Live({
  repoRoot,
  execute = false,
  recoverAmbiguousCandidateId = null,
  apiKey = process.env.GEMINI_API_KEY,
  fetchImpl = globalThis.fetch,
  customLedgerPath = null,
} = {}) {
  if (!apiKey) {
    try {
      process.loadEnvFile(path.join(repoRoot, '.env'))
    } catch {}
    if (!process.env.GEMINI_API_KEY && process.env.HOME) {
      try {
        process.loadEnvFile(path.join(process.env.HOME, '.env'))
      } catch {}
    }
    apiKey = process.env.GEMINI_API_KEY
  }

  if (!execute) throw new Error('SCALE_TRANCHE_2 live execution requires --execute')
  if (!apiKey) throw new Error('GEMINI_API_KEY is required')

  const currentLedgerPath = customLedgerPath || ledgerPath(repoRoot)
  const preflight = await preflightScaleTranche2Live({ repoRoot, customLedgerPath: currentLedgerPath })
  const { cohort } = preflight

  const [writerPrompt, repairPrompt, verifierPromptV11, verifierSchemaV11, voiceGuide, pricing] = await Promise.all([
    readFile(path.join(repoRoot, 'catalogue-pipeline/prompts/editorial-writer.v1.1.md'), 'utf8'),
    readFile(path.join(repoRoot, 'catalogue-pipeline/prompts/editorial-structural-repair.v1.md'), 'utf8'),
    readFile(path.join(repoRoot, 'catalogue-pipeline/prompts/source-boundary-risk-verifier.v1.1.md'), 'utf8'),
    readJson(path.join(repoRoot, 'catalogue-pipeline/schemas/source-boundary-risk-verifier.v1.1.schema.json')),
    readFile(path.join(repoRoot, 'catalogue-pipeline/calibration/voice-guide.md'), 'utf8'),
    readJson(path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/review/gemini-pricing-metadata.v1.json')),
  ])

  let ledger
  try {
    ledger = await readJson(currentLedgerPath)
  } catch {
    ledger = {
      schemaVersion: 'scale-tranche-2-live-execution-ledger.v1',
      trancheId: TRANCHE_ID,
      frozenBindings: EXPECTED_BINDINGS,
      riskVerifierLiveBinding: RISK_VERIFIER_LIVE_BINDING,
      productionWriterLiveBinding: PRODUCTION_WRITER_LIVE_BINDING,
      maximumEstimatedUSD: LIVE_USD_CEILING,
      callCaps: LIVE_CALL_CAPS,
      callCounts: {
        writerCalls: 0,
        structuralRepairCalls: 0,
        riskVerifierCalls: 0,
        totalExternalCalls: 0,
      },
      responseBearing5xx: 0,
      records: [],
      canaryOutcome: null,
      status: 'RUNNING',
      stop: null,
    }
  }
  ledger.__filePath = currentLedgerPath

  // Validate explicit recovery argument if supplied
  if (recoverAmbiguousCandidateId) {
    const target = ledger.records.find((r) => r.candidateId === recoverAmbiguousCandidateId)
    if (!target) {
      throw new Error(`Candidate ${recoverAmbiguousCandidateId} not found in ledger for recovery`)
    }
    const recoveryStatus = getAmbiguousRecoveryStatus(target, ledger)
    if (!recoveryStatus.isUnresolved) {
      throw new Error(`Candidate ${recoverAmbiguousCandidateId} is not in an unresolved ambiguous state: ${recoveryStatus.reason}`)
    }
    if (!recoveryStatus.recoverable) {
      ledger.status = 'STOPPED_AMBIGUOUS'
      ledger.stop = { code: 'AMBIGUOUS_RECOVERY_ATTEMPTS_EXHAUSTED', candidateId: target.candidateId }
      await canonical(currentLedgerPath, summarize(ledger))
      return ledger
    }
  }

  // Resume check: fail closed on unresolved ambiguous dispatches unless explicitly authorized
  const unresolved = ledger.records.find((record) => isUnresolvedPersistedDispatch(record, ledger))

  if (unresolved) {
    if (recoverAmbiguousCandidateId !== unresolved.candidateId) {
      ledger.status = 'STOPPED_AMBIGUOUS'
      ledger.stop = { code: 'UNRESOLVED_PERSISTED_DISPATCH', candidateId: unresolved.candidateId }
      await canonical(currentLedgerPath, summarize(ledger))
      return ledger
    }

    // Authorize exactly one controlled recovery for this specific candidate
    const stageName = getUnresolvedPersistedDispatchStage(unresolved)
    const originalStage = structuredClone(unresolved[stageName])
    originalStage.terminalState = 'AMBIGUOUS_UNRESOLVED'
    originalStage.dispatch.ambiguous = true

    unresolved.ambiguousDispatchRecovery = {
      stage: stageName,
      originalDispatchState: 'DISPATCHED',
      originalRequestHash: originalStage.request?.completeRequestHash ?? null,
      originalDispatchArtifactHash: hashArtifact(originalStage),
      recoveryAuthorized: true,
      recoveryAttempt: 1,
      maxRecoveryAttempts: 1,
      reason: 'OPERATOR_AUTHORIZED_UNRESOLVED_DISPATCH_RECOVERY',
      authorizedAt: new Date().toISOString(),
      originalDispatch: originalStage,
    }

    // Persist recovery audit record to candidate directory
    const recoveryAuditDir = path.join(executionRoot(repoRoot), stageName === 'writer' ? 'writers' : stageName === 'structuralRepair' ? 'structural-repairs' : 'risk-verifiers', unresolved.candidateId)
    await canonical(path.join(recoveryAuditDir, 'ambiguous-dispatch-recovery.json'), unresolved.ambiguousDispatchRecovery)

    // Reset the stage pointer to allow exactly one fresh recovery dispatch
    unresolved[stageName] = null
    ledger.status = 'RUNNING'
    ledger.stop = null
    await canonical(currentLedgerPath, summarize(ledger))
  }

  const byId = new Map(ledger.records.map((record) => [record.candidateId, record]))
  const voiceGuideBinding = {
    path: 'catalogue-pipeline/calibration/voice-guide.md',
    historicalSourceHash: hashBytes(voiceGuide),
  }

  const canaryCandidateIds = preflight.canaryCandidateIds
  const canarySet = new Set(canaryCandidateIds)
  const remainingCandidateIds = cohort.records
    .map((r) => r.candidateId)
    .filter((id) => !canarySet.has(id))

  // Execute in two phases: Canary (10) then Remaining (140)
  const candidateExecutionOrder = [
    ...canaryCandidateIds,
    ...remainingCandidateIds,
  ]
  const cohortRecordById = new Map(cohort.records.map((r) => [r.candidateId, r]))

  let canaryEvaluated = false

  for (let idx = 0; idx < candidateExecutionOrder.length; idx++) {
    const candidateId = candidateExecutionOrder[idx]
    const cohortRecord = cohortRecordById.get(candidateId)

    // Canary evaluation gate: after the first 10 candidates
    if (idx === CANARY_SIZE && !canaryEvaluated) {
      const canaryRecords = canaryCandidateIds.map((id) => byId.get(id))
      const canaryPassed =
        canaryRecords.length === CANARY_SIZE &&
        canaryRecords.every((r) => r && TERMINAL.has(r.terminalState)) &&
        !ledger.stop &&
        ledger.callCounts.totalExternalCalls <= LIVE_CALL_CAPS.totalExternalCalls &&
        ledger.accounting.totalEstimatedUSD < LIVE_USD_CEILING &&
        !canaryRecords.some((r) => r.riskVerifier?.terminalState === 'INVALID')

      if (!canaryPassed) {
        ledger.canaryOutcome = 'FAIL'
        ledger.status = 'STOPPED_CANARY_FAIL'
        ledger.stop = ledger.stop ?? { code: 'CANARY_VALIDATION_FAILED' }
        await canonical(ledgerPath(repoRoot), summarize(ledger))
        break
      } else {
        ledger.canaryOutcome = 'PASS'
        canaryEvaluated = true
        await canonical(ledgerPath(repoRoot), summarize(ledger))
      }
    }

    if (ledger.stop) break
    if (TERMINAL.has(byId.get(candidateId)?.terminalState)) continue

    const record = byId.get(candidateId) ?? {
      candidateId,
      tmdbId: cohortRecord.tmdbId,
      terminalState: 'PENDING',
      routingStatus: null,
      promotionState: 'GENERATED',
    }
    if (!byId.has(record.candidateId)) {
      ledger.records.push(record)
      byId.set(record.candidateId, record)
      await canonical(ledgerPath(repoRoot), summarize(ledger))
    }

    const packet = await sourcePacket(repoRoot, cohortRecord, voiceGuideBinding)
    const writerDir = path.join(executionRoot(repoRoot), 'writers', record.candidateId)
    const packetPath = path.join(writerDir, 'writer-input.json')
    await canonical(packetPath, packet)
    record.writerPacketPath = relative(repoRoot, packetPath)
    record.writerPacketHash = hashArtifact(packet)

    const writerSchema = buildEditorialGeminiSchema(record)

    // 1. Writer Stage
    let writer = record.writer
    if (!writer || !['VALID', 'INVALID', 'UNAVAILABLE', 'QUOTA_BLOCKED', 'AMBIGUOUS'].includes(writer.terminalState)) {
      writer = await dispatchStage({
        repoRoot,
        ledger,
        record,
        stage: 'writer',
        input: packet,
        promptText: writerPrompt,
        schema: writerSchema,
        thinkingLevel: PRODUCTION_WRITER_LIVE_BINDING.thinkingLevel,
        maxOutputTokens: PRODUCTION_WRITER_LIVE_BINDING.maxOutputTokens,
        pricing,
        apiKey,
        fetchImpl,
        validateOutput: (output) => validateWriterForCritic({ output, packet }),
      })
    } else if (writer.outputPath && !writer.output) {
      writer.output = await readJson(path.join(repoRoot, writer.outputPath))
    }

    if (ledger.stop) break
    if (!writer.output) {
      record.structuralValidation = 'UNAVAILABLE'
      record.structuralRepairStatus = 'NOT_REQUIRED'
      record.productionValidation = 'UNSAFE_TO_EVALUATE'
      record.routingStatus = 'QUARANTINED'
      record.promotionState = 'QUARANTINED'
      record.terminalState = 'WRITER_UNAVAILABLE'
      continue
    }

    record.structuralValidation = writer.validation.ok ? 'PASS' : 'FAIL'
    let finalOutput = writer.output
    let finalStage = writer

    // 2. Structural Repair Stage (Conditional, max 1)
    if (!writer.validation.ok) {
      if (!repairable(writer.validation)) {
        record.structuralRepairStatus = 'FAILED'
        record.productionValidation = 'UNSAFE_TO_EVALUATE'
        record.routingStatus = 'QUARANTINED'
        record.promotionState = 'QUARANTINED'
        record.terminalState = 'STRUCTURAL_QUARANTINED'
        continue
      }
      const repairInput = {
        originalAuthorizedPacket: packet,
        writerV11Contract: writerPrompt,
        deterministicValidatorFailures: writer.validation.hardFailures,
        immediatelyPrecedingWriterOutput: writer.output,
      }
      let repaired = record.structuralRepair
      if (!repaired || !['VALID', 'INVALID', 'UNAVAILABLE', 'QUOTA_BLOCKED', 'AMBIGUOUS'].includes(repaired.terminalState)) {
        repaired = await dispatchStage({
          repoRoot,
          ledger,
          record,
          stage: 'structuralRepair',
          input: repairInput,
          promptText: repairPrompt,
          schema: writerSchema,
          thinkingLevel: 'low',
          maxOutputTokens: WRITER_MAX_OUTPUT_TOKENS,
          pricing,
          apiKey,
          fetchImpl,
          validateOutput: (output) => validateWriterForCritic({ output, packet }),
        })
      } else if (repaired.outputPath && !repaired.output) {
        repaired.output = await readJson(path.join(repoRoot, repaired.outputPath))
      }

      if (ledger.stop) break
      if (!repaired.output || !repaired.validation.ok) {
        record.structuralRepairStatus = 'FAILED'
        record.productionValidation = 'FAIL'
        record.routingStatus = 'QUARANTINED'
        record.promotionState = 'QUARANTINED'
        record.terminalState = 'STRUCTURAL_QUARANTINED'
        continue
      }
      record.structuralRepairStatus = 'REPAIRED'
      finalOutput = repaired.output
      finalStage = repaired
    } else {
      record.structuralRepairStatus = 'NOT_REQUIRED'
    }

    // Save Editorial Artifact
    const editorialArtifact = {
      schemaVersion: 'editorial-artifact.v1.1',
      candidateId: record.candidateId,
      tmdbId: record.tmdbId,
      output: finalOutput,
      sourceHashes: Object.fromEntries(
        Object.entries(packet.sourceBindings).map(([key, val]) => [key, val.v8_2ArtifactHash])
      ),
    }
    const artifactDir = path.join(
      executionRoot(repoRoot),
      record.structuralRepairStatus === 'REPAIRED' ? 'structural-repairs' : 'writers',
      record.candidateId
    )
    const artifactPath = path.join(artifactDir, 'artifact.json')
    await canonical(artifactPath, editorialArtifact)
    finalStage.artifactPath = relative(repoRoot, artifactPath)
    finalStage.artifactHash = hashArtifact(editorialArtifact)
    record.finalEditorialArtifactPath = finalStage.artifactPath
    record.finalEditorialArtifactHash = finalStage.artifactHash
    record.productionValidation = 'PASS'

    // 3. Risk Verifier Stage (reconciled v1.1 semantic-only contract)
    const riskInput = buildRiskVerifierInput({ writerPacket: packet, visibleEditorialCopy: finalOutput.copy })
    const riskDir = path.join(executionRoot(repoRoot), 'risk-verifiers', record.candidateId)
    const riskInputPath = path.join(riskDir, 'risk-input.json')
    await canonical(riskInputPath, riskInput)
    record.riskVerifierInputPath = relative(repoRoot, riskInputPath)
    record.riskVerifierInputHash = hashArtifact(riskInput)

    const projectedVerifierSchema = providerVerifierSchema(verifierSchemaV11)

    let verifier = record.riskVerifier
    if (!verifier || !['VALID', 'INVALID', 'UNAVAILABLE', 'QUOTA_BLOCKED', 'AMBIGUOUS'].includes(verifier.terminalState)) {
      verifier = await dispatchStage({
        repoRoot,
        ledger,
        record,
        stage: 'riskVerifier',
        input: riskInput,
        promptText: verifierPromptV11,
        schema: projectedVerifierSchema,
        thinkingLevel: RISK_VERIFIER_LIVE_BINDING.thinkingLevel,
        maxOutputTokens: RISK_VERIFIER_LIVE_BINDING.maxOutputTokens,
        pricing,
        apiKey,
        fetchImpl,
        validateOutput: validateVerifierSemanticPayload,
      })
    } else if (verifier.outputPath && !verifier.output) {
      verifier.output = await readJson(path.join(repoRoot, verifier.outputPath))
    }

    if (ledger.stop) break

    if (verifier.output && verifier.validation?.ok) {
      const verifierArtifact = {
        schemaVersion: 'source-boundary-risk-artifact.v1',
        contractVersion: RISK_VERIFIER_LIVE_BINDING.contractVersion,
        candidateId: record.candidateId,
        tmdbId: record.tmdbId,
        output: verifier.output,
        sourceHashes: {
          riskInput: record.riskVerifierInputHash,
          editorialArtifact: record.finalEditorialArtifactHash,
        },
      }
      const verifierArtifactPath = path.join(riskDir, 'artifact.json')
      await canonical(verifierArtifactPath, verifierArtifact)
      verifier.artifactPath = relative(repoRoot, verifierArtifactPath)
      verifier.artifactHash = hashArtifact(verifierArtifact)

      const routed = routeProductionRecord({
        structuralValidation: record.structuralValidation,
        structuralRepairOutcome: record.structuralRepairStatus === 'REPAIRED' ? 'PASS' : 'NOT_REQUIRED',
        provenanceCompleteness: 'COMPLETE',
        riskVerifierResult: verifier.output.riskLevel,
        productionValidation: 'PASS',
        unresolvedSourceGroundingConflict: verifier.output.riskCategories.includes('UNRESOLVED_SOURCE_GROUNDING_CONFLICT'),
      })
      record.routingStatus = routed.riskRoutingStatus
      record.promotionState = routed.riskRoutingStatus === 'AUTO_ELIGIBLE' ? 'AUTO_ELIGIBLE' : 'HUMAN_REVIEW_PENDING'
    } else {
      record.routingStatus = 'HUMAN_REVIEW_REQUIRED'
      record.promotionState = 'HUMAN_REVIEW_PENDING'
    }

    record.terminalState = verifier.output && verifier.validation?.ok ? 'COMPLETE' : 'VERIFIER_UNAVAILABLE'
    await canonical(ledgerPath(repoRoot), summarize(ledger))
  }

  summarize(ledger)

  // 4. Finalize manifests if all 150 records reached terminal states
  if (!ledger.stop && ledger.records.length === TRANCHE_SIZE && ledger.records.every((r) => TERMINAL.has(r.terminalState))) {
    const routing = buildRoutingManifest(ledger, EXPECTED_BINDINGS)
    const autoIds = routing.records.filter((r) => r.routingStatus === 'AUTO_ELIGIBLE').map((r) => r.candidateId)
    const audit = {
      schemaVersion: 'scale-tranche-2-audit-manifest.v1',
      trancheId: TRANCHE_ID,
      auditMode: 'DETERMINISTIC_RANDOM_AUDIT',
      ...selectAuditCandidateIds(autoIds),
      frozenBindings: EXPECTED_BINDINGS,
    }
    const auditSet = new Set(audit.candidateIds)

    for (const record of routing.records) {
      if (auditSet.has(record.candidateId)) record.promotionState = 'AUDIT_PENDING'
    }

    // Prepare deduplicated Human Review Queue
    const queueRecords = routing.records
      .filter((r) => r.routingStatus === 'HUMAN_REVIEW_REQUIRED' || auditSet.has(r.candidateId))
      .map((r) => ({
        candidateId: r.candidateId,
        tmdbId: r.tmdbId,
        routingStatus: r.routingStatus,
        promotionState: auditSet.has(r.candidateId) ? 'AUDIT_PENDING' : 'HUMAN_REVIEW_PENDING',
        reviewReasons: [
          ...(r.riskLevel === 'HIGH_RISK' ? ['HIGH_RISK'] : []),
          ...(r.riskVerifierOutcome === 'UNAVAILABLE' || r.riskVerifierOutcome === 'QUOTA_BLOCKED' || r.riskVerifierOutcome === 'AMBIGUOUS'
            ? ['VERIFIER_UNAVAILABLE']
            : []),
          ...(r.routingStatus === 'HUMAN_REVIEW_REQUIRED' && r.riskLevel !== 'HIGH_RISK' && !['UNAVAILABLE', 'QUOTA_BLOCKED', 'AMBIGUOUS'].includes(r.riskVerifierOutcome)
            ? ['HUMAN_REVIEW_REQUIRED']
            : []),
          ...(auditSet.has(r.candidateId) ? ['AUDIT_SAMPLE'] : []),
        ],
        decision: null,
      }))

    const reviewReasonCounts = {
      HIGH_RISK: queueRecords.filter((r) => r.reviewReasons.includes('HIGH_RISK')).length,
      VERIFIER_UNAVAILABLE: queueRecords.filter((r) => r.reviewReasons.includes('VERIFIER_UNAVAILABLE')).length,
      HUMAN_REVIEW_REQUIRED: queueRecords.filter((r) => r.reviewReasons.includes('HUMAN_REVIEW_REQUIRED')).length,
      AUDIT_SAMPLE: queueRecords.filter((r) => r.reviewReasons.includes('AUDIT_SAMPLE')).length,
    }

    const queue = {
      schemaVersion: 'scale-tranche-2-human-review-queue.v1',
      trancheId: TRANCHE_ID,
      queueStatus: 'PENDING_NO_DECISIONS',
      records: queueRecords,
      count: queueRecords.length,
      reviewReasonCounts,
      humanDecisionsMade: 0,
      frozenBindings: EXPECTED_BINDINGS,
      noRuntimePromotion: true,
    }

    // Build blind packets
    const orderedQueueCandidateIds = deterministicBlindOrder(queueRecords.map((r) => r.candidateId))
    const riskInputMap = new Map()
    for (const q of queueRecords) {
      const p = path.join(executionRoot(repoRoot), 'risk-verifiers', q.candidateId, 'risk-input.json')
      riskInputMap.set(q.candidateId, await readJson(p))
    }
    const blindPackets = buildBlindPackets({
      queueRecords,
      routingRecords: routing.records,
      riskInputs: riskInputMap,
      orderedCandidateIds: orderedQueueCandidateIds,
    })

    // Execution closure summary
    const closure = {
      schemaVersion: 'scale-tranche-2-execution-closure.v1',
      trancheId: TRANCHE_ID,
      stage: 'AUTOMATED_EXECUTION_COMPLETED',
      readyForHumanAdjudication: true,
      frozenBindings: EXPECTED_BINDINGS,
      summary: {
        totalCohortSize: TRANCHE_SIZE,
        canarySize: CANARY_SIZE,
        canaryOutcome: ledger.canaryOutcome,
        writerValid: routing.aggregate.writerValid,
        structuralRepairsAttempted: routing.aggregate.repairAttempted,
        structuralRepairsSucceeded: routing.aggregate.repairSucceeded,
        structuralRepairsFailed: routing.aggregate.repairFailed,
        verifierLowRisk: routing.aggregate.verifierLowRisk,
        verifierHighRisk: routing.aggregate.verifierHighRisk,
        verifierUnavailable: routing.aggregate.verifierInvalidOrUnavailable,
        autoEligible: routing.aggregate.autoEligible,
        humanReviewRequired: routing.aggregate.humanReviewRequired,
        quarantined: routing.aggregate.quarantined,
        auditCount: audit.auditCount,
        deduplicatedHumanReviewQueueSize: queue.count,
      },
      accounting: ledger.accounting,
      safety: {
        runtimeChanges: 0,
        runtimeWritten: false,
        noPromotionTransaction: true,
        noHumanAdjudication: true,
        noTargetedRepair: true,
      },
    }

    const routingFile = path.join(root(repoRoot), 'routing-manifest.json')
    const auditFile = path.join(root(repoRoot), 'audit-manifest.json')
    const queueFile = path.join(root(repoRoot), 'human-review-queue.json')
    const blindFile = path.join(root(repoRoot), 'human-review-blind-packets.v1.json')
    const closureFile = path.join(root(repoRoot), 'execution-closure.v1.json')

    await Promise.all([
      canonical(routingFile, routing),
      canonical(auditFile, audit),
      canonical(queueFile, queue),
      canonical(blindFile, blindPackets),
      canonical(closureFile, closure),
    ])

    ledger.status = 'COMPLETE'
    ledger.manifests = {
      routing: { path: relative(repoRoot, routingFile), hash: hashArtifact(routing) },
      audit: { path: relative(repoRoot, auditFile), hash: hashArtifact(audit) },
      humanReviewQueue: { path: relative(repoRoot, queueFile), hash: hashArtifact(queue) },
      humanReviewBlindPackets: { path: relative(repoRoot, blindFile), hash: hashArtifact(blindPackets) },
      executionClosure: { path: relative(repoRoot, closureFile), hash: hashArtifact(closure) },
    }
  } else {
    ledger.status = ledger.stop ? 'STOPPED' : 'INCOMPLETE'
  }

  await canonical(currentLedgerPath, summarize(ledger))
  return ledger
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isDirectRun) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const execute = process.argv.includes('--execute')
  const preflightOnly = process.argv.includes('--preflight')
  const recoverIndex = process.argv.indexOf('--recover-ambiguous')
  let recoverAmbiguousCandidateId = null
  if (recoverIndex !== -1) {
    const nextArg = process.argv[recoverIndex + 1]
    if (!nextArg || nextArg.startsWith('--')) {
      console.error('Error: --recover-ambiguous requires a candidate ID')
      process.exit(1)
    }
    recoverAmbiguousCandidateId = nextArg
  }
  if (preflightOnly) {
    preflightScaleTranche2Live({ repoRoot })
      .then((res) => {
        console.log(
          JSON.stringify(
            {
              ok: res.ok,
              canarySize: res.canaryCandidateIds.length,
              liveLedgerInspection: res.liveLedgerInspection ?? null,
            },
            null,
            2
          )
        )
      })
      .catch((error) => {
        console.error(error.stack ?? error.message)
        process.exitCode = 1
      })
  } else {
    runScaleTranche2Live({ repoRoot, execute, recoverAmbiguousCandidateId })
      .then((ledger) => {
        console.log(
          JSON.stringify(
            {
              status: ledger.status,
              stop: ledger.stop,
              canaryOutcome: ledger.canaryOutcome,
              accounting: ledger.accounting,
              manifests: ledger.manifests ?? null,
            },
            null,
            2
          )
        )
      })
      .catch((error) => {
        console.error(error.stack ?? error.message)
        process.exitCode = 1
      })
  }
}
