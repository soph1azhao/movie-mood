import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export const V3_PROTOCOL_CLOSURE_RELATIVE = 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v3-protocol-closure.v1.json'

export class V3ProtocolClosureError extends Error {
  constructor(message, code = 'V3_PROTOCOL_CLOSURE_INVALID') { super(message); this.name = 'V3ProtocolClosureError'; this.code = code }
}

const rawSha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const fail = (message, code) => { throw new V3ProtocolClosureError(message, code) }

export async function verifyV3ProtocolClosure({ root = process.cwd() } = {}) {
  const recordPath = resolve(root, V3_PROTOCOL_CLOSURE_RELATIVE)
  const record = JSON.parse(await readFile(recordPath, 'utf8'))
  if (record.protocolId !== 'phase5c-c1b-v-confirmatory.v3') fail('Protocol identity mismatch.', 'PROTOCOL_ID_MISMATCH')
  if (record.closureKind !== 'POST_EXECUTION_FORENSIC_CLOSURE' || record.classificationIsNewProtocolRule !== false) fail('Closure semantics are invalid.', 'CLOSURE_SEMANTICS_MISMATCH')
  if (record.stage1?.status !== 'VALID' || record.stage1.completion !== 'COMPLETE' || record.stage1.forensicStatus !== 'FORENSICALLY CLOSED' || record.stage1.terminalStatus !== 'COMPLETE') fail('Stage-1 closure state is invalid.', 'STAGE1_STATUS_MISMATCH')
  const stage1Bytes = await readFile(resolve(root, record.stage1.closureArtifactPath))
  if (rawSha256(stage1Bytes) !== record.stage1.closureArtifactRawSha256) fail('Stage-1 closure hash changed.', 'STAGE1_CLOSURE_MUTATION')
  if (record.stage2?.executed !== false || record.stage2.wikipediaLiveRequests !== 0 || record.stage2.coverageResultExists !== false || record.stage2.viabilityDistributionExists !== false || record.stage2.status !== 'NOT EXECUTED') fail('Stage-2 execution state is invalid.', 'STAGE2_EXECUTION_MISMATCH')
  if (record.laterStages?.humanGoldExecuted !== false || record.laterStages.semanticEfficacyInferenceExecuted !== false || record.laterStages.stage3Started !== false || record.laterStages.stage4PlusStarted !== false) fail('Later-stage execution state is invalid.', 'LATER_STAGE_EXECUTION_MISMATCH')
  if (record.studyClassification !== 'BLOCKED — STAGE-2 FROZEN POLICY DEPENDENCY NOT FORENSICALLY REPRODUCIBLE') fail('Study classification mismatch.', 'STUDY_CLASSIFICATION_MISMATCH')
  for (const source of record.directFrozenPolicySources.sources) {
    if (rawSha256(await readFile(resolve(root, source.path))) !== source.rawSha256) fail(`Frozen source hash changed: ${source.path}`, 'FROZEN_SOURCE_MUTATION')
  }
  for (const observation of record.transitivePolicyDependencyObservations) {
    if (observation.frozenV3Source !== false || observation.gitTrackedAtClosure !== false || observation.provenanceClassification !== 'STRONG_PRE_FREEZE_BEHAVIORAL_PROVENANCE_ONLY') fail('Transitive dependency observation was misclassified.', 'DEPENDENCY_OBSERVATION_MISMATCH')
  }
  for (const artifact of Object.values(record.frozenSpecificationArtifacts)) {
    if (rawSha256(await readFile(resolve(root, artifact.path))) !== artifact.rawSha256) fail(`Frozen specification changed: ${artifact.path}`, 'SPECIFICATION_MUTATION')
  }
  return { ok: true, recordPath, protocolId: record.protocolId, stage1TerminalStatus: record.stage1.terminalStatus, stage2Executed: record.stage2.executed, wikipediaLiveRequests: record.stage2.wikipediaLiveRequests, networkCallsDuringClosure: record.networkCallsDuringClosure }
}
