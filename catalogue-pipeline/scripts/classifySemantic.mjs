import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import taxonomy from '../config/taxonomyVersion.json' with { type: 'json' }
import anchors from '../calibration/anchors.json' with { type: 'json' }
import boundaryCases from '../calibration/boundaryCases.json' with { type: 'json' }
import semanticSchema from '../schemas/semantic.schema.json' with { type: 'json' }
import { createModelCacheKey, runStructuredModelRequest } from '../adapters/modelProvider.ts'
import { stableHash } from '../adapters/tmdbProvider.ts'
import { validateSemanticOutput } from './validateBatch.mjs'

export const SEMANTIC_PROMPT_VERSION = 'semantic-classifier.v1'
export const SEMANTIC_SCHEMA_VERSION = 'semantic-output.v1'
export const SEMANTIC_INPUT_SCHEMA_VERSION = 'semantic-input.v1'

const defaultCacheRoot = resolve('catalogue-pipeline/cache/semantic')
const defaultOutputRoot = resolve('catalogue-pipeline/generated/semantic')

export class SemanticClassifierError extends Error {
  constructor(message, { code = 'SEMANTIC_CLASSIFIER_ERROR', details = {} } = {}) {
    super(message)
    this.name = 'SemanticClassifierError'
    this.code = code
    this.details = details
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function pathExists(path) {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

async function writeJsonIfChanged(path, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`
  let previous = null
  try {
    previous = await readFile(path, 'utf8')
  } catch {
    previous = null
  }
  if (previous === serialized) return false

  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.tmp`
  try {
    await writeFile(tempPath, serialized)
    await rename(tempPath, path)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
  return true
}

function requiredSourceRefs(evidencePacket) {
  return new Set((evidencePacket.sourceProvenance ?? []).map((source) => source.source))
}

export function assertEvidencePacket(evidencePacket) {
  if (!evidencePacket || evidencePacket.schemaVersion !== 'evidence-packet.v1') {
    throw new SemanticClassifierError('Semantic classification requires an evidence-packet.v1 artifact.', { code: 'INVALID_EVIDENCE_PACKET' })
  }
  if (!evidencePacket.candidateId || !Number.isInteger(evidencePacket.tmdbId) || !evidencePacket.inputHash) {
    throw new SemanticClassifierError('Evidence packet is missing candidate identity or input hash.', { code: 'INVALID_EVIDENCE_PACKET' })
  }
}

export function buildSemanticClassifierInput({ evidencePacket, prompt, promptVersion = SEMANTIC_PROMPT_VERSION, taxonomyDefinition = taxonomy, calibrationAnchors = anchors, calibrationBoundaryCases = boundaryCases }) {
  assertEvidencePacket(evidencePacket)
  return {
    schemaVersion: SEMANTIC_INPUT_SCHEMA_VERSION,
    promptVersion,
    prompt,
    evidencePacket,
    taxonomy: taxonomyDefinition,
    calibrationAnchors,
    boundaryCases: calibrationBoundaryCases,
  }
}

function validateSourceReferences(output, sourceRefs) {
  const issues = []
  const inspect = (item, field) => {
    for (const sourceRef of item?.sourceRefs ?? []) {
      if (!sourceRefs.has(sourceRef)) issues.push({ severity: 'hard_fail', code: 'UNKNOWN_EVIDENCE_SOURCE_REF', field, message: `${field} references unavailable evidence source ${sourceRef}.` })
    }
  }
  for (const [value, item] of Object.entries(output.evidence?.moods ?? {})) inspect(item, `evidence.moods.${value}`)
  for (const [value, item] of Object.entries(output.evidence?.situations ?? {})) inspect(item, `evidence.situations.${value}`)
  for (const field of ['pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle']) inspect(output.evidence?.[field], `evidence.${field}`)
  return issues
}

function assertClassifierOnly(output) {
  const editorialFields = ['description', 'whyWatch', 'curiosityHook', 'vibeSummary', 'copy', 'writerNotes']
  const present = editorialFields.filter((field) => Object.prototype.hasOwnProperty.call(output, field))
  if (present.length > 0) throw new SemanticClassifierError('Classifier output must not include editorial fields.', { code: 'CLASSIFIER_EDITORIAL_SEPARATION', details: { fields: present } })
}

function artifactOutputHash(artifact) {
  const { outputHash, ...hashable } = artifact
  return `sha256:${stableHash(hashable)}`
}

export function summarizeCalibrationReplay({ targets, artifacts }) {
  const byId = new Map(artifacts.map((artifact) => [artifact.movie?.tmdbId, artifact]))
  const orderedFields = ['pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle']
  const result = {
    records: targets.length,
    orderedExactAgreement: Object.fromEntries(orderedFields.map((field) => [field, { matches: 0, total: 0 }])),
    moodSituationOverlap: { moods: [], situations: [] },
    severeDisagreements: [],
    boundaryDisagreements: [],
    evidenceQuality: { complete: 0, incomplete: 0 },
  }

  for (const target of targets) {
    const artifact = byId.get(target.tmdbId)
    if (!artifact) continue
    for (const field of orderedFields) {
      result.orderedExactAgreement[field].total += 1
      if (artifact.classification[field] === target[field]) result.orderedExactAgreement[field].matches += 1
      else if (['pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle'].includes(field)) {
        const order = taxonomy[field]
        if (Math.abs(order.indexOf(artifact.classification[field]) - order.indexOf(target[field])) > 1) result.severeDisagreements.push({ tmdbId: target.tmdbId, field, expected: target[field], actual: artifact.classification[field] })
      }
    }
    for (const field of ['moods', 'situations']) {
      const actual = new Set(artifact.classification[field])
      const expected = new Set(target[field])
      const intersection = [...actual].filter((value) => expected.has(value)).length
      const union = new Set([...actual, ...expected]).size
      result.moodSituationOverlap[field].push({ tmdbId: target.tmdbId, overlap: union === 0 ? 1 : intersection / union })
    }
    if ((artifact.boundaryFlags ?? []).length > 0) result.boundaryDisagreements.push({ tmdbId: target.tmdbId, flags: artifact.boundaryFlags })
    if ((artifact.evidence?.moods && artifact.evidence?.situations && artifact.evidence?.pace && artifact.evidence?.emotionalWeight && artifact.evidence?.attentionDemand && artifact.evidence?.discoveryStyle)) result.evidenceQuality.complete += 1
    else result.evidenceQuality.incomplete += 1
  }
  for (const value of Object.values(result.orderedExactAgreement)) value.rate = value.total === 0 ? null : value.matches / value.total
  for (const field of ['moods', 'situations']) result.moodSituationOverlap[field] = result.moodSituationOverlap[field].map((entry) => entry.overlap)
  return result
}

export async function classifySemanticCandidate({
  evidencePacket,
  provider,
  prompt,
  promptVersion = SEMANTIC_PROMPT_VERSION,
  taxonomyDefinition = taxonomy,
  calibrationAnchors = anchors,
  calibrationBoundaryCases = boundaryCases,
  cacheRoot = defaultCacheRoot,
  outputPath,
  createdAt = new Date().toISOString(),
  maxAttempts = 2,
  delayFn,
  readJsonFile = readJson,
  writeJsonFile = writeJsonIfChanged,
  fileExists = pathExists,
}) {
  assertEvidencePacket(evidencePacket)
  if (!provider?.metadata?.providerId || !provider?.metadata?.modelId) throw new SemanticClassifierError('Semantic classifier requires a configured provider metadata object.', { code: 'MISSING_MODEL_PROVIDER' })

  const input = buildSemanticClassifierInput({ evidencePacket, prompt, promptVersion, taxonomyDefinition, calibrationAnchors, calibrationBoundaryCases })
  const cacheKey = createModelCacheKey({
    stage: 'semantic-classifier',
    tmdbId: evidencePacket.tmdbId,
    factsHash: evidencePacket.inputHash,
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    promptVersion,
    taxonomyVersion: taxonomyDefinition.taxonomyVersion,
    calibrationHash: stableHash({ calibrationAnchors, calibrationBoundaryCases }),
    providerId: provider.metadata.providerId,
    modelId: provider.metadata.modelId,
  })
  const cachePath = resolve(cacheRoot, `${cacheKey}.json`)
  const targetPath = outputPath ?? resolve(defaultOutputRoot, `${evidencePacket.candidateId}.json`)

  if (await fileExists(cachePath)) {
    const artifact = await readJsonFile(cachePath)
    const wroteArtifact = await writeJsonFile(targetPath, artifact)
    return {
      artifact,
      cacheKey,
      cachePath,
      outputPath: targetPath,
      cacheHit: true,
      modelCalls: 0,
      retries: 0,
      classificationsCompleted: 1,
      providerUsageMetadata: artifact.providerMetadata?.providerUsageMetadata ?? null,
      wroteArtifact,
    }
  }

  const modelResult = await runStructuredModelRequest({
    provider,
    request: { stage: 'semantic-classifier', schemaVersion: SEMANTIC_SCHEMA_VERSION, promptVersion, input, outputSchema: semanticSchema, temperature: 0.1, maxRetries: maxAttempts },
    validateOutput: (rawOutput) => {
      assertClassifierOnly(rawOutput)
      const candidateOutput = {
        schemaVersion: SEMANTIC_SCHEMA_VERSION,
        promptVersion,
        taxonomyVersion: taxonomyDefinition.taxonomyVersion,
        movie: { candidateId: evidencePacket.candidateId, tmdbId: evidencePacket.tmdbId },
        ...rawOutput,
      }
      const validation = validateSemanticOutput(candidateOutput)
      return { ok: validation.ok, hardFailures: validation.hardFailures }
    },
    maxAttempts,
    ...(delayFn ? { delayFn } : {}),
  })

  assertClassifierOnly(modelResult.output)
  const artifact = {
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    promptVersion,
    taxonomyVersion: taxonomyDefinition.taxonomyVersion,
    modelProvider: provider.metadata.providerId,
    modelId: provider.metadata.modelId,
    movie: { candidateId: evidencePacket.candidateId, tmdbId: evidencePacket.tmdbId },
    classification: modelResult.output.classification,
    evidence: modelResult.output.evidence,
    boundaryFlags: modelResult.output.boundaryFlags,
    ...(modelResult.output.selfConfidence ? { selfConfidence: modelResult.output.selfConfidence } : {}),
    inputHash: `sha256:${stableHash({ evidencePacketHash: evidencePacket.inputHash, promptHash: stableHash(prompt), taxonomyHash: stableHash(taxonomyDefinition), anchorsHash: stableHash(calibrationAnchors), boundaryCasesHash: stableHash(calibrationBoundaryCases) })}`,
    evidencePacketHash: evidencePacket.inputHash,
    calibration: { anchorsHash: `sha256:${stableHash(calibrationAnchors)}`, boundaryCasesHash: `sha256:${stableHash(calibrationBoundaryCases)}` },
    cacheKey,
    providerMetadata: modelResult.metadata,
    createdAt,
  }
  artifact.outputHash = artifactOutputHash(artifact)

  const validation = validateSemanticOutput(artifact)
  const sourceReferenceFailures = validateSourceReferences(artifact, requiredSourceRefs(evidencePacket))
  if (!validation.ok || sourceReferenceFailures.length > 0) {
    throw new SemanticClassifierError('Semantic classifier output failed deterministic validation.', { code: 'INVALID_SEMANTIC_OUTPUT', details: { validation, sourceReferenceFailures } })
  }

  await writeJsonFile(cachePath, artifact)
  const wroteArtifact = await writeJsonFile(targetPath, artifact)
  return {
    artifact,
    cacheKey,
    cachePath,
    outputPath: targetPath,
    cacheHit: false,
    modelCalls: modelResult.metadata.attempts,
    retries: Math.max(0, modelResult.metadata.attempts - 1),
    classificationsCompleted: 1,
    providerUsageMetadata: modelResult.metadata.providerUsageMetadata ?? null,
    wroteArtifact,
  }
}

async function main() {
  const [evidencePacketPath, providerModulePath] = process.argv.slice(2)
  if (!evidencePacketPath || !providerModulePath) throw new SemanticClassifierError('Usage: node catalogue-pipeline/scripts/classifySemantic.mjs <evidence-packet.json> <ignored-provider-module.mjs>', { code: 'MISSING_CLASSIFIER_ARGUMENTS' })
  const providerModule = await import(pathToFileURL(resolve(providerModulePath)).href)
  if (!providerModule.provider) throw new SemanticClassifierError('Provider module must export provider.', { code: 'MISSING_MODEL_PROVIDER' })
  const [evidencePacket, prompt] = await Promise.all([readJson(resolve(evidencePacketPath)), readFile(new URL('../prompts/semantic-classifier.v1.md', import.meta.url), 'utf8')])
  const result = await classifySemanticCandidate({ evidencePacket, provider: providerModule.provider, prompt })
  console.log(`Semantic classification ${result.wroteArtifact ? 'written' : 'unchanged'}: ${result.outputPath}`)
  console.log(`Model calls: ${result.modelCalls}; cache hit: ${result.cacheHit}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
