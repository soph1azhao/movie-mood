import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateExplicitFinalJudgments } from './verifierV14ContinuationValidation.mjs';

const dir = 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/codex-assisted-continuation';
const packets = JSON.parse(await readFile(`${dir}/candidate-packets-86-184.compact.v1.json`, 'utf8')).packets;
const finalBytes = await readFile(`${dir}/adjudications-86-184.final.v1.jsonl`);
const lines = finalBytes.toString('utf8').split('\n');
if (lines.at(-1) === '') lines.pop();
if (lines.some((line) => !line.trim())) throw new Error('Blank final judgment line');
const records = lines.map((line) => JSON.parse(line));
const counts = validateExplicitFinalJudgments(packets, records);
const sha256 = `sha256:${createHash('sha256').update(finalBytes).digest('hex')}`;
console.log(JSON.stringify({ candidateCount: records.length, counts, finalSha256: sha256 }, null, 2));
