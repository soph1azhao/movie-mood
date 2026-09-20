import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateExplicitFinalJudgments } from './verifierV14ContinuationValidation.mjs';

const packets = Array.from({ length: 99 }, (_, index) => ({
  sequenceIndex: 86 + index,
  candidateId: `candidate-${86 + index}`,
}));
const judgments = packets.map(({ sequenceIndex, candidateId }) => ({
  sequenceIndex,
  candidateId,
  finalDecision: 'APPROVE',
  finalSeverity: null,
  affectedFields: [],
  materialIssues: [],
  humanRationale: 'Explicit approval after review.',
}));

test('complete explicit final judgments validate', () => {
  assert.deepEqual(validateExplicitFinalJudgments(packets, judgments), { approve: 99, minor: 0, severe: 0 });
});

test('missing candidate fails closed instead of becoming APPROVE', () => {
  assert.throws(() => validateExplicitFinalJudgments(packets, judgments.slice(1)), /Missing explicit final judgment at sequence 86/);
});

test('duplicate sequence fails closed', () => {
  assert.throws(() => validateExplicitFinalJudgments(packets, [...judgments, judgments[0]]), /Duplicate final judgment sequence: 86/);
});

test('candidate-ID mismatch fails closed', () => {
  const changed = judgments.map((record) => ({ ...record }));
  changed[0].candidateId = 'wrong-candidate';
  assert.throws(() => validateExplicitFinalJudgments(packets, changed), /Candidate ID mismatch at sequence 86/);
});

test('unexpected sequence fails closed', () => {
  assert.throws(() => validateExplicitFinalJudgments(packets, [...judgments, { ...judgments[0], sequenceIndex: 185 }]), /Unexpected final judgment sequence: 185/);
});
