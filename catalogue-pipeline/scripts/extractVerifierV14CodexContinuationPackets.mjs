import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const experiment = 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development';
const outputDir = `${experiment}/codex-assisted-continuation`;
const order = JSON.parse(await readFile(`${experiment}/blind-review-order.v1.json`, 'utf8'));
const pool = JSON.parse(await readFile(`${experiment}/blind-review-eligible-pool.v1.json`, 'utf8'));
const byId = new Map(pool.records.map((record) => [record.candidateId, record]));
const packets = [];

for (const entry of order.orderedCandidates.filter((entry) => entry.reviewSequenceIndex >= 86)) {
  const poolRecord = byId.get(entry.candidateId);
  if (!poolRecord) throw new Error(`Missing pool record: ${entry.candidateId}`);
  const inputBytes = await readFile(poolRecord.frozenRiskInputPath);
  const input = JSON.parse(inputBytes);
  if (input.facts.title === undefined || input.facts.year === undefined) {
    throw new Error(`Missing title/year: ${entry.candidateId}`);
  }
  packets.push({
    sequenceIndex: entry.reviewSequenceIndex,
    candidateId: entry.candidateId,
    title: input.facts.title,
    year: input.facts.year,
    allowedSourceMaterial: input.allowedSourceMaterial,
    acceptedSemanticClassification: input.acceptedSemanticClassification,
    permittedFactualMetadata: {
      director: input.facts.director,
      genres: input.facts.genres,
      countries: input.facts.countries,
      runtimeMinutes: input.facts.runtimeMinutes,
      spokenLanguages: input.facts.spokenLanguages,
    },
    spoilerBoundaryRules: input.spoilerBoundaryRules,
    visibleEditorialCopy: input.visibleEditorialCopy,
    frozenRiskInputPath: poolRecord.frozenRiskInputPath,
    frozenRiskInputSha256: `sha256:${createHash('sha256').update(inputBytes).digest('hex')}`,
  });
}

await mkdir(outputDir, { recursive: true });
await writeFile(`${outputDir}/candidate-packets-86-184.compact.v1.json`, `${JSON.stringify({
  activity: 'VERIFIER_V1_4_CODEX_ASSISTED_CONTINUATION_PACKET_EXTRACTION',
  candidateCount: packets.length,
  excludes: ['facts.keywords', 'semanticBoundaryFlags', 'advisory artifacts'],
  packets,
}, null, 2)}\n`);
