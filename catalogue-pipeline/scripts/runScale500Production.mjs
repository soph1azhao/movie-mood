import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildAcquisitionPreflight, runScale500FactualAcquisition } from './runScale500FactualAcquisition.mjs'
import { writeSemanticCohortManifest } from './buildSemanticCohort.mjs'
import { buildSemanticNPreflight, launchAdaptiveSemanticN, semanticRunId } from './runKimiAdaptiveSemanticN.mjs'
import { summarizeAdaptiveBatch } from './adaptiveSemanticBatchCore.mjs'

export const SCALE_500_PRODUCTION_AUTHORIZATION_FLAG = '--execute-authorized-scale-500-production'
export const SCALE_500_CADENCE = Object.freeze([200, 300, 400, 500])
export const CHECKPOINT_ACQUISITION_HTTP_CAP = 120
export const CHECKPOINT_ACQUISITION_CANDIDATE_CAP = 120
export const CHECKPOINT_SEMANTIC_HTTP_CAP = 125
export const CHECKPOINT_SEMANTIC_CANDIDATE_CAP = 100

export class Scale500ProductionError extends Error { constructor(message, { code = 'SCALE_500_PRODUCTION_ERROR', details = {} } = {}) { super(message); this.name = 'Scale500ProductionError'; this.code = code; this.details = details } }
const fail = (message, code, details = {}) => { throw new Scale500ProductionError(message, { code, details }) }

function completed(summary, target) {
  return summary.importedValid + summary.generatedValidThisRun === target && summary.pending === 0 && summary.providerFailures === 0 && summary.uncertain === 0 && summary.terminalSemanticFailures === 0
}

export async function buildScale500ProductionPreflight({ root = process.cwd(), pipelineRoot = resolve(root, 'catalogue-pipeline'), acquisitionPreflight = buildAcquisitionPreflight, semanticPreflight = buildSemanticNPreflight } = {}) {
  const stages = []
  for (const target of SCALE_500_CADENCE) {
    const acquisitionTarget = target - 100
    const acquisition = await acquisitionPreflight({ root, targetReadyCount: acquisitionTarget })
    let semantic = null
    try { semantic = (await semanticPreflight({ target, pipelineRoot })).preflight } catch (error) { if (!['REQUIRED_MANIFEST_MISSING', 'ACQUISITION_STATE_NOT_FOUND'].includes(error?.code)) throw error }
    stages.push({ target, runId: semanticRunId(target), priorRunId: semanticRunId(target - 100), acquisitionTarget, acquisition, semantic, complete: Boolean(semantic && semantic.importedValid + semantic.generatedValidThisRun === target && semantic.pendingFresh === 0) })
  }
  return { executionAuthorized: false, cadence: [100, ...SCALE_500_CADENCE], budgetsPerCheckpoint: { acquisition: { maxFreshCandidates: CHECKPOINT_ACQUISITION_CANDIDATE_CAP, maxHttpRequests: CHECKPOINT_ACQUISITION_HTTP_CAP }, semantic: { maxFreshCandidates: CHECKPOINT_SEMANTIC_CANDIDATE_CAP, maxHttpRequests: CHECKPOINT_SEMANTIC_HTTP_CAP } }, stages }
}

export async function runScale500Production(argv = process.argv.slice(2), { root = process.cwd(), pipelineRoot = resolve(root, 'catalogue-pipeline'), env = process.env, acquisitionPreflight = buildAcquisitionPreflight, acquire = runScale500FactualAcquisition, buildCohort = writeSemanticCohortManifest, semanticPreflight = buildSemanticNPreflight, launchSemantic = launchAdaptiveSemanticN, ...options } = {}) {
  const preflight = await buildScale500ProductionPreflight({ root, pipelineRoot, acquisitionPreflight, semanticPreflight })
  if (!argv.includes(SCALE_500_PRODUCTION_AUTHORIZATION_FLAG)) return preflight
  if (!env.TMDB_READ_ACCESS_TOKEN?.trim() || !env.KIMI_API_KEY?.trim()) fail('TMDB_READ_ACCESS_TOKEN and KIMI_API_KEY are required.', 'MISSING_CREDENTIAL')
  const results = []
  for (const target of SCALE_500_CADENCE) {
    const existing = await acquisitionPreflight({ root, targetReadyCount: target - 100 })
    if (existing.uncertainCount > 0) fail('Acquisition has an ambiguous prior dispatch; manual resolution is required.', 'UNCERTAIN_ACQUISITION', { target })
    if (!existing.targetMet) {
      const acquired = await acquire({ root, token: env.TMDB_READ_ACCESS_TOKEN, targetReadyCount: target - 100, maxFreshCandidates: CHECKPOINT_ACQUISITION_CANDIDATE_CAP, maxHttpRequests: CHECKPOINT_ACQUISITION_HTTP_CAP, ...options })
      if (!acquired.targetMet || acquired.readyCount !== target - 100) return { executionAuthorized: true, status: 'STOPPED_ACQUISITION_SHORTFALL', stoppedAt: target, preflight, results: [...results, { target, acquisition: acquired }] }
    }
    const runId = semanticRunId(target); const priorRunId = semanticRunId(target - 100)
    let context
    try { context = await semanticPreflight({ target, pipelineRoot }) } catch (error) {
      if (error?.code !== 'REQUIRED_MANIFEST_MISSING') throw error
      await buildCohort({ cohortId: runId, targetCount: target, priorRunId, pipelineRoot })
      context = await semanticPreflight({ target, pipelineRoot })
    }
    if (context.preflight.importedValid !== target - 100) fail('Imported semantic checkpoint count mismatch.', 'IMPORT_COUNT_MISMATCH', { target })
    let summary = context.manifest ? summarizeAdaptiveBatch(context.manifest) : null
    if (!summary || !completed(summary, target)) {
      if (summary?.uncertain > 0) return { executionAuthorized: true, status: 'STOPPED_UNCERTAIN_DISPATCH', stoppedAt: target, preflight, results }
      const semantic = await launchSemantic(['--target', String(target), '--max-fresh-candidates', '100', '--max-http-requests', '125', '--execute-authorized-semantic-n'], { pipelineRoot, env, ...options })
      summary = summarizeAdaptiveBatch(semantic.manifest)
      results.push({ target, semantic: summary })
    }
    if (!completed(summary, target)) return { executionAuthorized: true, status: 'STOPPED_SEMANTIC_INCOMPLETE', stoppedAt: target, preflight, results }
  }
  return { executionAuthorized: true, status: 'COMPLETE', preflight, results }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runScale500Production().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(`${error.message} [${error.code ?? 'ERROR'}]`); process.exitCode = 1 })
