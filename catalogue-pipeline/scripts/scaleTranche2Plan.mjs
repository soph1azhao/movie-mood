import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { buildEditorialGeminiSchema } from '../adapters/geminiEditorialProvider.mjs'
import { FIXED_PILOT } from './editorialPilot.mjs'
import {
  auditPilotCandidates,
  buildCohortManifest,
  buildExecutionPlan,
  computeAuthoritativeAccounting,
  filterCandidatePool,
  hashCandidateSet,
  loadAndValidateAuthoritativeCandidatePool,
  resolveSemanticArtifactPath,
  selectCohortCandidateIds,
} from './scalePipeline.mjs'
import { hashArtifact, hashBytes, serializeArtifactForPersistence } from './validatePromotionContract.mjs'

export const TRANCHE_ID = 'SCALE_TRANCHE_2'
export const TRANCHE_SIZE = 150
export const NORMAL_REMAINING_POOL_SIZE = 300
export const COHORT_SEED_ID = 'movie-mood-v8.2-scale-tranche-2-v1'
export const AUDIT_SEED_ID = 'movie-mood-v8.2-scale-tranche-2-audit-v1'
export const AUDIT_RATE = 0.20
export const PRIOR_DEFERRED_ID = 'exp100-tmdb-1156593'
export const THEORETICAL_MAXIMUM_MODEL_CALLS = 450
export const EXPECTED_MODEL_CALLS = 310
export const HARD_MODEL_CALL_CAP = 450
export const COST_CEILING_USD = 2.00
export const EMPIRICAL_EXPECTED_USD = 1.074
export const PESSIMISTIC_THEORETICAL_USD = 1.591

export const outputRoot = (repoRoot) => path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2')
const readJson = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'))
const relative = (repoRoot, filePath) => path.relative(repoRoot, filePath).split(path.sep).join('/')
const canonical = async (filePath, value) => {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, serializeArtifactForPersistence(value))
}

export async function buildScaleTranche2Artifacts({ repoRoot, persist = true } = {}) {
  const semanticCohortPath = path.join(repoRoot, 'catalogue-pipeline/generated/semantic/batches/kimi-k28-adaptive-semantic-400-v1/cohort-manifest.json')
  const semanticManifestPath = path.join(repoRoot, 'catalogue-pipeline/generated/semantic/batches/kimi-k28-adaptive-semantic-400-v1/manifest.json')
  const t1CohortPath = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/cohort-manifest.json')
  const t1AssemblyPath = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/production-assembly.v1.1.json')
  const pilotManifestPath = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/pilot-manifest.json')
  const governancePath = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/review/v8-2-scalable-promotion-governance.v1.json')
  const expansionFactsPath = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-expansion/expansion-100-v1/factual-snapshot.json')
  const scaleFactsPath = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-expansion/scale-500-v1/factual-snapshot.json')

  const writerPromptPath = path.join(repoRoot, 'catalogue-pipeline/prompts/editorial-writer.v1.1.md')
  const repairPromptPath = path.join(repoRoot, 'catalogue-pipeline/prompts/editorial-structural-repair.v1.md')
  const verifierPromptPath = path.join(repoRoot, 'catalogue-pipeline/prompts/source-boundary-risk-verifier.v1.md')
  const verifierSchemaPath = path.join(repoRoot, 'catalogue-pipeline/schemas/source-boundary-risk-verifier.v1.schema.json')

  const [
    semanticCohort,
    semanticManifest,
    t1Cohort,
    t1Assembly,
    pilotManifest,
    governance,
    expansionFacts,
    scaleFacts,
    writerPrompt,
    repairPrompt,
    verifierPrompt,
    verifierSchema,
  ] = await Promise.all([
    readJson(semanticCohortPath),
    readJson(semanticManifestPath),
    readJson(t1CohortPath),
    readJson(t1AssemblyPath),
    readJson(pilotManifestPath),
    readJson(governancePath),
    readJson(expansionFactsPath),
    readJson(scaleFactsPath),
    readFile(writerPromptPath, 'utf8'),
    readFile(repairPromptPath, 'utf8'),
    readFile(verifierPromptPath, 'utf8'),
    readJson(verifierSchemaPath),
  ])

  // 1. Authoritative Accounting & Invariant Verification
  const accounting = computeAuthoritativeAccounting({
    semanticManifest,
    t1CohortManifest: t1Cohort,
    t1ProductionAssembly: t1Assembly,
    pilotManifest,
    fixedPilotIds: FIXED_PILOT.map((p) => p.candidateId),
  })

  // Validate Semantic-400 entries
  const { entries: s400Entries } = loadAndValidateAuthoritativeCandidatePool({
    semanticCohort,
    semanticManifest,
  })

  const sourceArtifactHashes = {
    semanticCohort: hashArtifact(semanticCohort),
    semanticManifest: hashArtifact(semanticManifest),
    t1CohortManifest: hashArtifact(t1Cohort),
    t1ProductionAssembly: hashArtifact(t1Assembly),
    pilotManifest: hashArtifact(pilotManifest),
    governance: hashArtifact(governance),
    expansionFacts: hashArtifact(expansionFacts),
    scaleFacts: hashArtifact(scaleFacts),
    writerPrompt: hashBytes(writerPrompt),
    repairPrompt: hashBytes(repairPrompt),
    verifierPrompt: hashBytes(verifierPrompt),
    verifierSchema: hashArtifact(verifierSchema),
  }

  const remainingAccountingArtifact = {
    schemaVersion: 'remaining-catalogue-accounting.v1',
    accountingSummary: {
      semanticTotal: accounting.semanticTotal,
      t1CohortTotal: accounting.t1CohortTotal,
      productionComplete: accounting.productionComplete,
      deferredFromPriorTranche: accounting.deferredFromPriorTranche,
      normalRemainingPool: accounting.normalRemainingPool,
      pilotCount: accounting.pilotCount,
      freshCount: accounting.freshCount,
      totalUnresolved: accounting.totalUnresolved,
    },
    invariantsSatisfied: accounting.invariantsSatisfied,
    setHashes: accounting.setHashes,
    sourceArtifactHashes,
    authoritativeSets: {
      deferredCandidateId: PRIOR_DEFERRED_ID,
      t1CohortCount: accounting.t1CohortTotal,
      normalRemainingCount: accounting.normalRemainingPool,
      pilotCount: accounting.pilotCount,
      freshCount: accounting.freshCount,
    },
  }

  // 2. Pilot Candidate Reuse Audit
  const pilotCandidateIds = accounting.sets.pilot16Ids
  const pilotReuseAudit = await auditPilotCandidates({
    repoRoot,
    pilotCandidateIds,
    semanticManifest,
    expansionFacts,
    scaleFacts,
    currentWriterPromptVersion: 'editorial-writer.v1.1',
  })

  // 3. Normal Remaining Pool Selection
  const excludedIds = [...accounting.sets.t1CohortIds, PRIOR_DEFERRED_ID]
  const candidatePool = filterCandidatePool({
    candidatePool: accounting.sets.s400Ids,
    excludedCandidateIds: excludedIds,
  })

  if (candidatePool.length !== NORMAL_REMAINING_POOL_SIZE) {
    throw new Error(`Expected candidatePool of size ${NORMAL_REMAINING_POOL_SIZE}, got ${candidatePool.length}`)
  }

  const selectedCandidateIds = selectCohortCandidateIds({
    candidatePool,
    trancheSize: TRANCHE_SIZE,
    cohortSeed: COHORT_SEED_ID,
  })

  // 4. Build Records
  const entryById = new Map(s400Entries.map((e) => [e.candidateId, e]))
  const factsById = new Map([...expansionFacts.facts, ...scaleFacts.facts].map((f) => [f.candidateId, f]))
  const pilotSet = new Set(pilotCandidateIds)
  const pilotAuditMap = new Map(pilotReuseAudit.records.map((r) => [r.candidateId, r]))

  const records = await Promise.all(selectedCandidateIds.map(async (candidateId) => {
    const entry = entryById.get(candidateId)
    const state = semanticManifest.states[candidateId]
    const facts = factsById.get(candidateId)
    if (!entry || !state || !facts || entry.tmdbId !== facts.tmdbId) {
      throw new Error(`Incomplete source binding for candidate: ${candidateId}`)
    }

    const semanticArtifactPath = resolveSemanticArtifactPath(repoRoot, state, candidateId)
    const evRoot = candidateId.startsWith('exp100-') ? 'expansion-100-v1' : 'scale-500-v1'
    const evPath = path.join(repoRoot, `catalogue-pipeline/generated/catalogue-expansion/${evRoot}/evidence-packets/${candidateId}.json`)
    const [semanticArtifact, evidencePacket] = await Promise.all([
      readJson(semanticArtifactPath),
      readJson(evPath),
    ])

    const factsRelPath = `catalogue-pipeline/generated/catalogue-expansion/${evRoot}/factual-snapshot.json`
    const isPilot = pilotSet.has(candidateId)
    const pilotAudit = isPilot ? pilotAuditMap.get(candidateId) : null

    return {
      candidateId,
      tmdbId: entry.tmdbId,
      sourceClassification: isPilot ? 'HISTORICAL_PILOT' : 'FRESH',
      pilotReuseClassification: pilotAudit ? pilotAudit.classification : null,
      sourceBindings: {
        semanticArtifact: {
          path: relative(repoRoot, semanticArtifactPath),
          artifactHash: hashArtifact(semanticArtifact),
          historicalSourceHash: state.lifetimeProvenance?.artifactHash ?? state.artifactHash,
        },
        evidencePacket: {
          path: relative(repoRoot, evPath),
          artifactHash: hashArtifact(evidencePacket),
          historicalSourceHash: state.evidencePacketHash,
        },
        factsRecord: {
          path: factsRelPath,
          artifactHash: hashArtifact(facts),
          historicalSourceHash: facts.factsHash.startsWith('sha256:') ? facts.factsHash : `sha256:${facts.factsHash}`,
        },
      },
    }
  }))

  // 5. Cohort Manifest
  const cohortManifest = buildCohortManifest({
    trancheId: TRANCHE_ID,
    schemaVersion: 'scale-tranche-2-cohort-manifest.v1',
    trancheSize: TRANCHE_SIZE,
    cohortSeed: COHORT_SEED_ID,
    sourceCount: 400,
    normalRemainingCount: NORMAL_REMAINING_POOL_SIZE,
    selectedCandidateIds,
    sourcePoolCandidateIds: candidatePool,
    excludedCandidateIds: excludedIds,
    priorDeferredCandidateIds: [PRIOR_DEFERRED_ID],
    pilotCandidateIds,
    pilotReuseAudit,
    sourceManifestBindings: {
      semanticCohort: { path: relative(repoRoot, semanticCohortPath), hash: sourceArtifactHashes.semanticCohort },
      semanticExecution: { path: relative(repoRoot, semanticManifestPath), hash: sourceArtifactHashes.semanticManifest },
      priorTrancheCohort: { path: relative(repoRoot, t1CohortPath), hash: sourceArtifactHashes.t1CohortManifest },
    },
    records,
  })

  // 6. Execution Plan
  const writerSchemas = records.map(({ candidateId, tmdbId }) => ({
    candidateId,
    schemaHash: hashArtifact(buildEditorialGeminiSchema({ candidateId, tmdbId })),
  }))

  const cohortManifestHash = hashArtifact(cohortManifest)

  const executionPlan = buildExecutionPlan({
    trancheId: TRANCHE_ID,
    schemaVersion: 'scale-tranche-2-execution-plan.v1',
    trancheSize: TRANCHE_SIZE,
    auditRate: AUDIT_RATE,
    auditSeed: AUDIT_SEED_ID,
    selectedCandidateIds,
    cohortManifestHash,
    pilotReuseAudit,
    maxBudgetUSD: COST_CEILING_USD,
    empiricalExpectedUSD: EMPIRICAL_EXPECTED_USD,
    pessimisticTheoreticalUSD: PESSIMISTIC_THEORETICAL_USD,
    expectedModelCalls: EXPECTED_MODEL_CALLS,
    hardModelCallCap: HARD_MODEL_CALL_CAP,
    writerCallsMaximum: TRANCHE_SIZE,
    structuralRepairCallsMaximum: TRANCHE_SIZE,
    riskVerifierCallsMaximum: TRANCHE_SIZE,
    writerPromptVersion: 'editorial-writer.v1.1',
    writerPromptPath: relative(repoRoot, writerPromptPath),
    writerPromptHash: sourceArtifactHashes.writerPrompt,
    repairPromptPath: relative(repoRoot, repairPromptPath),
    repairPromptHash: sourceArtifactHashes.repairPrompt,
    verifierPromptPath: relative(repoRoot, verifierPromptPath),
    verifierPromptHash: sourceArtifactHashes.verifierPrompt,
    verifierSchemaPath: relative(repoRoot, verifierSchemaPath),
    verifierSchemaHash: sourceArtifactHashes.verifierSchema,
    authoritativeGovernance: {
      path: relative(repoRoot, governancePath),
      hash: sourceArtifactHashes.governance,
    },
    plannedNamespaces: {
      writers: 'execution/scale-tranche-2/writers/<candidateId>/',
      structuralRepairs: 'execution/scale-tranche-2/structural-repairs/<candidateId>/',
      riskVerifiers: 'execution/scale-tranche-2/risk-verifiers/<candidateId>/',
    },
    perCandidateSchemaBindingsHash: hashArtifact(writerSchemas),
  })

  // 7. Persist Artifacts
  const outDir = outputRoot(repoRoot)
  const paths = {
    remainingAccountingPath: path.join(outDir, 'remaining-catalogue-accounting.json'),
    pilotReuseAuditPath: path.join(outDir, 'pilot-reuse-audit.json'),
    cohortManifestPath: path.join(outDir, 'cohort-manifest.json'),
    executionPlanPath: path.join(outDir, 'execution-plan.json'),
  }

  if (persist) {
    await canonical(paths.remainingAccountingPath, remainingAccountingArtifact)
    await canonical(paths.pilotReuseAuditPath, pilotReuseAudit)
    await canonical(paths.cohortManifestPath, cohortManifest)
    await canonical(paths.executionPlanPath, executionPlan)
  }

  const hashes = {
    remainingAccountingHash: hashArtifact(remainingAccountingArtifact),
    pilotReuseAuditHash: hashArtifact(pilotReuseAudit),
    cohortManifestHash,
    executionPlanHash: hashArtifact(executionPlan),
  }

  return {
    accounting: remainingAccountingArtifact,
    pilotReuseAudit,
    cohortManifest,
    executionPlan,
    paths,
    hashes,
    externalCalls: 0,
    modelCalls: 0,
    runtimeChanges: 0,
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isDirectRun) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  buildScaleTranche2Artifacts({ repoRoot })
    .then(({ paths, hashes, externalCalls, modelCalls, runtimeChanges }) => {
      console.log(JSON.stringify({ paths, hashes, externalCalls, modelCalls, runtimeChanges }, null, 2))
    })
    .catch((err) => {
      console.error(err.stack ?? err.message)
      process.exitCode = 1
    })
}
