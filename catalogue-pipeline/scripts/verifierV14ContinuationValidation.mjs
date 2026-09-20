const FIRST_SEQUENCE = 86;
const LAST_SEQUENCE = 184;

export function validateExplicitFinalJudgments(packets, records) {
  if (!Array.isArray(packets) || !Array.isArray(records)) {
    throw new Error('Packets and final judgments must be arrays');
  }

  const expected = new Map();
  for (const packet of packets) {
    const sequence = packet.sequenceIndex;
    if (!Number.isInteger(sequence) || sequence < FIRST_SEQUENCE || sequence > LAST_SEQUENCE) {
      throw new Error(`Unexpected packet sequence: ${sequence}`);
    }
    if (expected.has(sequence)) throw new Error(`Duplicate packet sequence: ${sequence}`);
    if (typeof packet.candidateId !== 'string' || !packet.candidateId) {
      throw new Error(`Missing packet candidate ID at sequence ${sequence}`);
    }
    expected.set(sequence, packet.candidateId);
  }
  if (expected.size !== LAST_SEQUENCE - FIRST_SEQUENCE + 1) {
    throw new Error(`Frozen packets must contain every sequence ${FIRST_SEQUENCE}–${LAST_SEQUENCE}`);
  }
  for (let sequence = FIRST_SEQUENCE; sequence <= LAST_SEQUENCE; sequence += 1) {
    if (!expected.has(sequence)) throw new Error(`Missing frozen packet sequence: ${sequence}`);
  }

  const seen = new Set();
  const counts = { approve: 0, minor: 0, severe: 0 };
  for (const record of records) {
    const sequence = record.sequenceIndex;
    if (!expected.has(sequence)) throw new Error(`Unexpected final judgment sequence: ${sequence}`);
    if (seen.has(sequence)) throw new Error(`Duplicate final judgment sequence: ${sequence}`);
    seen.add(sequence);
    if (record.candidateId !== expected.get(sequence)) {
      throw new Error(`Candidate ID mismatch at sequence ${sequence}`);
    }
    if (typeof record.humanRationale !== 'string' || !record.humanRationale.trim()) {
      throw new Error(`Missing explicit rationale at sequence ${sequence}`);
    }
    if (!Array.isArray(record.affectedFields) || !Array.isArray(record.materialIssues)) {
      throw new Error(`Invalid issue arrays at sequence ${sequence}`);
    }
    if (record.finalDecision === 'APPROVE') {
      if (record.finalSeverity !== null || record.affectedFields.length || record.materialIssues.length) {
        throw new Error(`Invalid APPROVE fields at sequence ${sequence}`);
      }
      counts.approve += 1;
    } else if (record.finalDecision === 'REVISE') {
      if (record.finalSeverity !== 'MINOR' && record.finalSeverity !== 'SEVERE') {
        throw new Error(`Invalid REVISE severity at sequence ${sequence}`);
      }
      if (!record.affectedFields.length || !record.materialIssues.length) {
        throw new Error(`REVISE requires fields and material issues at sequence ${sequence}`);
      }
      counts[record.finalSeverity.toLowerCase()] += 1;
    } else {
      throw new Error(`Missing or invalid explicit decision at sequence ${sequence}`);
    }
  }
  for (let sequence = FIRST_SEQUENCE; sequence <= LAST_SEQUENCE; sequence += 1) {
    if (!seen.has(sequence)) throw new Error(`Missing explicit final judgment at sequence ${sequence}`);
  }
  return counts;
}
