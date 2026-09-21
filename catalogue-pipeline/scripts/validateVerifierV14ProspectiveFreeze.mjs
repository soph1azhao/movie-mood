import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const R2_1_PROTOCOL_PATH = 'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/PROTOCOL.md';
export const R2_1_PROTOCOL_SHA256 = '1258c3d823b838ec17e3b6efb49259b111cf097abc9a65fedfe51c4769158f57';

export const R2_1_MANIFEST_PATH = 'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/protocol-manifest.v1.json';
export const R2_1_MANIFEST_SHA256 = '77fe25568bd03951114d2885dc518a121bc3406eac8cf51815ac1d2d75527955';

export const R2_1_REQUIRED_SURFACES = Object.freeze([
  'facts',
  'acceptedSemanticClassification',
  'semanticBoundaryFlags',
  'allowedSourceMaterial',
  'spoilerBoundaryRules',
  'copyConstraints',
  'visibleEditorialCopy',
]);

export const R2_1_FAILURE_CLASSES = Object.freeze([
  'material_contradiction_or_identity_role_substitution',
  'unsupported_causal_motive_mechanism_or_setting_quantity_concretization',
  'spoiler_reveal_or_consequence_leakage',
]);

export const R2_1_HUMAN_ROLES = Object.freeze([
  'independent_custodian',
  'challenge_construction_author',
  'challenge_adjudicator_A',
  'challenge_adjudicator_B',
  'natural_primary_adjudicator',
  'natural_QA_adjudicator',
  'natural_reconciliation_adjudicator',
  'verifier_operator',
]);

export const FORBIDDEN_HOLDOUT_CONTENT_KEYS = Object.freeze([
  'candidateId',
  'tmdbId',
  'imdbId',
  'movie_id',
  'title',
  'originalTitle',
  'overview',
  'facts',
  'keywords',
  'visibleEditorialCopy',
  'description',
  'whyWatch',
  'curiosityHook',
  'vibeSummary',
  'humanDecision',
  'severity',
  'label',
  'riskLevel',
  'riskCategories',
  'issues',
  'route',
  'riskRoutingStatus',
]);

export const R2_1_SOURCE_ARTIFACT_HASHES = Object.freeze({
  'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/protocol.v1.json':
    '7ccef839cc7bf434156881f6d8c12130a8d5e444e6038a95c50df8572c7c0f4d',
  'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.4.md':
    'a2fe3ef32f5b417544276401d5b520274fc77ef97753da61c253032b3f1e0d7f',
  'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json':
    'aa73ad6463e47c835186f8f2705f5c46167cd053ec43c1a0d72014ccc68c26dc',
  'catalogue-pipeline/scripts/validateVerifierV13Contract.mjs':
    '258c1520779fd147bf9c4aaa1c31c385d1da1fbd0f4835d381e30f767efab5b6',
  'catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/scale-tranche-1/human-review-materiality-policy.v1.json':
    '21661892df4d1b009341b6d34de3bf5ad1ae17e3447abbdace15e1c31a5b843c',
  'catalogue-pipeline/scripts/scaleTranche1Plan.mjs':
    'de201c6695d8198aac7059ceab1e1630cca9db9448b68c62a93a46137e98287c',
  'catalogue-pipeline/scripts/runVerifierV13RetrospectiveReplay.mjs':
    '3976a45b6e0655599c97bb560d6463ff78715a68b676225d117113a5f7382690',
  'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/blind-human-review-packet.schema.v1.json':
    '6bae3f04c4fc8d80d03e86adc389fb68a83b79098209b60fc498c59e0a4af257',
});

export const R2_1_EXPECTED_TOOLCHAIN_FILES = Object.freeze([
  'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/execution-freeze-record.schema.v1.json',
  'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/challenge-attempt-manifest.schema.v1.json',
  'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/challenge-qualification-manifest.schema.v1.json',
  'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/replacement-holdout-commitment.schema.v1.json',
  'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/runtime-dependency-declaration.schema.v1.json',
  'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/operator-log.schema.v1.json',
  'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/human-resource-confirmation.schema.v1.json',
  'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/analysis-plan.schema.v1.json',
  'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/challenge-source-exclusion.schema.v1.json',
  'catalogue-pipeline/scripts/validateVerifierV14ProspectiveFreeze.mjs',
  'catalogue-pipeline/scripts/validateVerifierV14ProspectiveFreeze.test.mjs',
  'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/FREEZE_PREPARATION_README.md',
]);

export function computeSha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Deterministic JSON Schema validator (Draft 2020-12 compatible subset).
 * Validates type, const, enum, pattern, min/maxLength, min/maximum,
 * min/maxItems, uniqueItems, required, properties, additionalProperties,
 * items, not, anyOf, allOf, oneOf.
 */
export function validateJsonSchema(data, schema, pathTrace = '$') {
  if (schema === true) return true;
  if (schema === false) {
    throw new Error(`Schema validation failed at ${pathTrace}: false schema`);
  }
  if (!schema || typeof schema !== 'object') {
    return true;
  }

  // Handle 'not'
  if (schema.not !== undefined) {
    let matched = false;
    try {
      validateJsonSchema(data, schema.not, `${pathTrace}.not`);
      matched = true;
    } catch {
      matched = false;
    }
    if (matched) {
      throw new Error(`Schema validation failed at ${pathTrace}: data matched forbidden 'not' schema`);
    }
  }

  // Handle 'anyOf'
  if (Array.isArray(schema.anyOf)) {
    let anyPassed = false;
    for (let i = 0; i < schema.anyOf.length; i++) {
      try {
        validateJsonSchema(data, schema.anyOf[i], `${pathTrace}.anyOf[${i}]`);
        anyPassed = true;
        break;
      } catch {
        // continue
      }
    }
    if (!anyPassed) {
      throw new Error(`Schema validation failed at ${pathTrace}: data did not match anyOf schema`);
    }
  }

  // Handle 'allOf'
  if (Array.isArray(schema.allOf)) {
    for (let i = 0; i < schema.allOf.length; i++) {
      validateJsonSchema(data, schema.allOf[i], `${pathTrace}.allOf[${i}]`);
    }
  }

  // Handle 'oneOf'
  if (Array.isArray(schema.oneOf)) {
    let passCount = 0;
    for (let i = 0; i < schema.oneOf.length; i++) {
      try {
        validateJsonSchema(data, schema.oneOf[i], `${pathTrace}.oneOf[${i}]`);
        passCount++;
      } catch {
        // continue
      }
    }
    if (passCount !== 1) {
      throw new Error(`Schema validation failed at ${pathTrace}: expected exactly oneOf match, got ${passCount}`);
    }
  }

  // Handle 'type'
  if (schema.type !== undefined) {
    const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actualType = getJsonType(data);
    const typeMatches = allowedTypes.some((t) => {
      if (t === 'number') return typeof data === 'number' && !Number.isNaN(data);
      if (t === 'integer') return Number.isInteger(data);
      return t === actualType;
    });
    if (!typeMatches) {
      throw new Error(
        `Schema validation failed at ${pathTrace}: expected type ${JSON.stringify(schema.type)}, got ${actualType}`
      );
    }
  }

  // Handle 'const'
  if (schema.const !== undefined) {
    if (!deepStrictEqual(data, schema.const)) {
      throw new Error(
        `Schema validation failed at ${pathTrace}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(data)}`
      );
    }
  }

  // Handle 'enum'
  if (Array.isArray(schema.enum)) {
    const inEnum = schema.enum.some((val) => deepStrictEqual(data, val));
    if (!inEnum) {
      throw new Error(
        `Schema validation failed at ${pathTrace}: value ${JSON.stringify(data)} not in enum ${JSON.stringify(schema.enum)}`
      );
    }
  }

  // Handle string validations
  if (typeof data === 'string') {
    if (schema.pattern !== undefined) {
      const reg = new RegExp(schema.pattern);
      if (!reg.test(data)) {
        throw new Error(
          `Schema validation failed at ${pathTrace}: string ${JSON.stringify(data)} does not match pattern ${schema.pattern}`
        );
      }
    }
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      throw new Error(
        `Schema validation failed at ${pathTrace}: string length ${data.length} < minLength ${schema.minLength}`
      );
    }
    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      throw new Error(
        `Schema validation failed at ${pathTrace}: string length ${data.length} > maxLength ${schema.maxLength}`
      );
    }
  }

  // Handle number/integer validations
  if (typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) {
      throw new Error(
        `Schema validation failed at ${pathTrace}: number ${data} < minimum ${schema.minimum}`
      );
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      throw new Error(
        `Schema validation failed at ${pathTrace}: number ${data} > maximum ${schema.maximum}`
      );
    }
  }

  // Handle array validations
  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      throw new Error(
        `Schema validation failed at ${pathTrace}: array length ${data.length} < minItems ${schema.minItems}`
      );
    }
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      throw new Error(
        `Schema validation failed at ${pathTrace}: array length ${data.length} > maxItems ${schema.maxItems}`
      );
    }
    if (schema.uniqueItems === true) {
      for (let i = 0; i < data.length; i++) {
        for (let j = i + 1; j < data.length; j++) {
          if (deepStrictEqual(data[i], data[j])) {
            throw new Error(
              `Schema validation failed at ${pathTrace}: duplicate item at indices ${i} and ${j}`
            );
          }
        }
      }
    }
    if (schema.items) {
      for (let i = 0; i < data.length; i++) {
        validateJsonSchema(data[i], schema.items, `${pathTrace}[${i}]`);
      }
    }
  }

  // Handle object validations
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    if (Array.isArray(schema.required)) {
      for (const reqKey of schema.required) {
        if (data[reqKey] === undefined) {
          throw new Error(
            `Schema validation failed at ${pathTrace}: missing required property '${reqKey}'`
          );
        }
      }
    }
    const propSchemas = schema.properties || {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(data)) {
        if (propSchemas[key] === undefined) {
          throw new Error(
            `Schema validation failed at ${pathTrace}: unexpected additional property '${key}'`
          );
        }
      }
    } else if (typeof schema.additionalProperties === 'object') {
      for (const key of Object.keys(data)) {
        if (propSchemas[key] === undefined) {
          validateJsonSchema(data[key], schema.additionalProperties, `${pathTrace}.${key}`);
        }
      }
    }
    for (const key of Object.keys(propSchemas)) {
      if (data[key] !== undefined) {
        validateJsonSchema(data[key], propSchemas[key], `${pathTrace}.${key}`);
      }
    }
  }

  return true;
}

function getJsonType(val) {
  if (val === null) return 'null';
  if (Array.isArray(val)) return 'array';
  if (typeof val === 'number') return Number.isInteger(val) ? 'integer' : 'number';
  return typeof val;
}

function deepStrictEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepStrictEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepStrictEqual(a[k], b[k])) return false;
  }
  return true;
}

/**
 * Safely resolves a repository-relative path against workspaceRoot.
 * Fails closed on:
 * - absolute paths
 * - '..' traversal
 * - paths outside workspaceRoot
 * - missing files
 * - directories
 * - intermediate or final symlinks that escape workspaceRoot (evaluated via fs.realpathSync)
 */
export function resolveSafeWorkspacePath(relativePath, workspaceRoot) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error(`Invalid path commitment: ${relativePath}`);
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error(`SECURITY_VIOLATION: Absolute path forbidden: ${relativePath}`);
  }

  const normalized = path.normalize(relativePath);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    throw new Error(`SECURITY_VIOLATION: Path traversal detected: ${relativePath}`);
  }

  const normalizedRoot = path.resolve(workspaceRoot);
  const resolved = path.resolve(normalizedRoot, relativePath);

  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    throw new Error(`SECURITY_VIOLATION: Path escapes workspace root: ${relativePath}`);
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`FILE_NOT_FOUND: Referenced file does not exist: ${relativePath}`);
  }

  const realRoot = fs.realpathSync(normalizedRoot);
  const realResolved = fs.realpathSync(resolved);

  if (!realResolved.startsWith(realRoot + path.sep) && realResolved !== realRoot) {
    throw new Error(`SECURITY_VIOLATION: Path escapes workspace root via symlink: ${relativePath}`);
  }

  const stat = fs.statSync(realResolved);
  if (stat.isDirectory()) {
    throw new Error(`INVALID_FILE: Referenced path is a directory, not a file: ${relativePath}`);
  }

  return realResolved;
}

/**
 * Verifies that a committed file exists, is safe, and has an exact SHA-256 byte match.
 */
export function verifyCommittedFileSha256(relativePath, committedSha256, workspaceRoot) {
  if (typeof committedSha256 !== 'string' || !committedSha256.trim()) {
    throw new Error(`Missing or invalid SHA-256 commitment for ${relativePath}`);
  }

  const resolved = resolveSafeWorkspacePath(relativePath, workspaceRoot);
  const rawBytes = fs.readFileSync(resolved);
  const actualSha256 = 'sha256:' + computeSha256(rawBytes);

  const cleanCommitted = committedSha256.startsWith('sha256:')
    ? committedSha256
    : 'sha256:' + committedSha256;

  if (actualSha256 !== cleanCommitted) {
    throw new Error(
      `SHA_MISMATCH: Hash verification failed for ${relativePath}: expected ${cleanCommitted}, computed ${actualSha256}`
    );
  }

  return { resolved, rawBytes, actualSha256 };
}

/**
 * Evaluates the terminal natural arm rate gates according to r2.1:
 * - humanCleanCount >= 20
 * - humanMinorCount >= 20
 * - cleanHighRiskCount <= floor(0.10 * humanCleanCount)
 * - minorLowRiskCount <= floor(0.10 * humanMinorCount)
 * Strictly enforces protocol-consistent invariants and impossible-state guards.
 */
export function evaluateNaturalArmRateGate({
  humanCleanCount,
  humanMinorCount,
  cleanHighRiskCount,
  minorLowRiskCount,
  validNaturalPackets = humanCleanCount + humanMinorCount,
}) {
  if (!Number.isInteger(humanCleanCount) || humanCleanCount < 0) {
    throw new Error(`Invalid humanCleanCount: ${humanCleanCount}`);
  }
  if (!Number.isInteger(humanMinorCount) || humanMinorCount < 0) {
    throw new Error(`Invalid humanMinorCount: ${humanMinorCount}`);
  }
  if (!Number.isInteger(cleanHighRiskCount) || cleanHighRiskCount < 0) {
    throw new Error(`Invalid cleanHighRiskCount: ${cleanHighRiskCount}`);
  }
  if (!Number.isInteger(minorLowRiskCount) || minorLowRiskCount < 0) {
    throw new Error(`Invalid minorLowRiskCount: ${minorLowRiskCount}`);
  }
  if (!Number.isInteger(validNaturalPackets) || validNaturalPackets < 0) {
    throw new Error(`Invalid validNaturalPackets: ${validNaturalPackets}`);
  }
  if (validNaturalPackets > 100) {
    throw new Error(`IMPOSSIBLE_STATE: validNaturalPackets (${validNaturalPackets}) exceeds maximum protocol bound of 100`);
  }
  if (humanCleanCount > validNaturalPackets) {
    throw new Error(`IMPOSSIBLE_STATE: humanCleanCount (${humanCleanCount}) exceeds validNaturalPackets (${validNaturalPackets})`);
  }
  if (humanMinorCount > validNaturalPackets) {
    throw new Error(`IMPOSSIBLE_STATE: humanMinorCount (${humanMinorCount}) exceeds validNaturalPackets (${validNaturalPackets})`);
  }
  if (humanCleanCount + humanMinorCount > validNaturalPackets) {
    throw new Error(
      `IMPOSSIBLE_STATE: sum of clean (${humanCleanCount}) and minor (${humanMinorCount}) exceeds validNaturalPackets (${validNaturalPackets})`
    );
  }
  if (cleanHighRiskCount > humanCleanCount) {
    throw new Error(
      `IMPOSSIBLE_STATE: cleanHighRiskCount (${cleanHighRiskCount}) exceeds its denominator humanCleanCount (${humanCleanCount})`
    );
  }
  if (minorLowRiskCount > humanMinorCount) {
    throw new Error(
      `IMPOSSIBLE_STATE: minorLowRiskCount (${minorLowRiskCount}) exceeds its denominator humanMinorCount (${humanMinorCount})`
    );
  }

  const cleanAllowed = Math.floor(0.10 * humanCleanCount);
  const minorAllowed = Math.floor(0.10 * humanMinorCount);

  if (humanCleanCount < 20 || humanMinorCount < 20) {
    return {
      status: 'INCONCLUSIVE',
      reason: 'INSUFFICIENT_DENOMINATOR',
      humanCleanCount,
      humanMinorCount,
      cleanAllowed,
      minorAllowed,
      cleanPassed: cleanHighRiskCount <= cleanAllowed,
      minorPassed: minorLowRiskCount <= minorAllowed,
    };
  }

  const cleanPassed = cleanHighRiskCount <= cleanAllowed;
  const minorPassed = minorLowRiskCount <= minorAllowed;

  if (cleanPassed && minorPassed) {
    return {
      status: 'PASS',
      cleanAllowed,
      minorAllowed,
      cleanHighRiskCount,
      minorLowRiskCount,
      humanCleanCount,
      humanMinorCount,
    };
  }

  return {
    status: 'FAIL',
    reason: 'TERMINAL_RATE_EXCEEDED',
    cleanAllowed,
    minorAllowed,
    cleanHighRiskCount,
    minorLowRiskCount,
    humanCleanCount,
    humanMinorCount,
    cleanPassed,
    minorPassed,
  };
}

/**
 * Mechanically qualifies challenge attempts according to r2.1:
 * - 18 total attempts across 3 classes (6 per class)
 * - Both initial human adjudicators must judge SEVERE
 * - Select exactly first 4 qualifying cases in frozen attempt order per class
 * - Returns 12 qualifying cases + nonqualifying diagnostic provenance
 */
export function evaluateChallengeArmQualification(attempts) {
  if (!Array.isArray(attempts) || attempts.length !== 18) {
    throw new Error(`Challenge attempts must contain exactly 18 cases, received ${attempts?.length}`);
  }

  const classCounts = new Map(R2_1_FAILURE_CLASSES.map((fc) => [fc, 0]));
  const seenIndices = new Set();
  const seenIds = new Set();

  for (const attempt of attempts) {
    if (!attempt || typeof attempt !== 'object') {
      throw new Error('Each challenge attempt must be an object');
    }
    if (!attempt.attemptId || typeof attempt.attemptId !== 'string') {
      throw new Error('Missing or invalid attemptId in challenge attempt');
    }
    if (seenIds.has(attempt.attemptId)) {
      throw new Error(`Duplicate challenge attemptId: ${attempt.attemptId}`);
    }
    seenIds.add(attempt.attemptId);

    if (!R2_1_FAILURE_CLASSES.includes(attempt.failureClass)) {
      throw new Error(`Unknown failure class: ${attempt.failureClass}`);
    }
    classCounts.set(attempt.failureClass, classCounts.get(attempt.failureClass) + 1);

    const order = attempt.attemptOrderIndex;
    if (!Number.isInteger(order) || order < 1 || order > 18) {
      throw new Error(`Invalid attemptOrderIndex: ${order}`);
    }
    if (seenIndices.has(order)) {
      throw new Error(`Duplicate attemptOrderIndex: ${order}`);
    }
    seenIndices.add(order);
  }

  for (const [fc, count] of classCounts.entries()) {
    if (count !== 6) {
      throw new Error(`Failure class ${fc} must have exactly 6 attempts, found ${count}`);
    }
  }

  // Sort by frozen attemptOrderIndex
  const sorted = [...attempts].sort((a, b) => a.attemptOrderIndex - b.attemptOrderIndex);

  const qualifyingByClass = new Map(R2_1_FAILURE_CLASSES.map((fc) => [fc, []]));
  const nonqualifying = [];

  for (const attempt of sorted) {
    const isUnanimousSevere =
      attempt.adjudicatorAJudgment === 'SEVERE' && attempt.adjudicatorBJudgment === 'SEVERE';

    if (!isUnanimousSevere) {
      const reason =
        attempt.adjudicatorAJudgment !== attempt.adjudicatorBJudgment
          ? 'DISQUALIFIED_DISAGREEMENT'
          : 'DISQUALIFIED_NON_SEVERE';

      if (attempt.qualificationState !== reason) {
        throw new Error(
          `Qualification state mismatch for attempt ${attempt.attemptId}: expected ${reason}, got ${attempt.qualificationState}`
        );
      }
      nonqualifying.push({
        attemptId: attempt.attemptId,
        failureClass: attempt.failureClass,
        attemptOrderIndex: attempt.attemptOrderIndex,
        dispositionReason: reason,
      });
      continue;
    }

    if (attempt.qualificationState !== 'QUALIFIES_UNANIMOUS_SEVERE') {
      throw new Error(
        `Qualification state mismatch for attempt ${attempt.attemptId}: expected QUALIFIES_UNANIMOUS_SEVERE, got ${attempt.qualificationState}`
      );
    }

    const classQualifying = qualifyingByClass.get(attempt.failureClass);
    if (classQualifying.length < 4) {
      classQualifying.push(attempt);
    } else {
      nonqualifying.push({
        attemptId: attempt.attemptId,
        failureClass: attempt.failureClass,
        attemptOrderIndex: attempt.attemptOrderIndex,
        dispositionReason: 'SURPLUS_QUALIFYING_BEYOND_FOUR',
      });
    }
  }

  const qualifyingPerClassCounts = {};
  let totalQualifying = 0;
  for (const [fc, list] of qualifyingByClass.entries()) {
    qualifyingPerClassCounts[fc] = list.length;
    totalQualifying += list.length;
  }

  const hasAll12 = R2_1_FAILURE_CLASSES.every((fc) => qualifyingByClass.get(fc).length === 4);

  if (!hasAll12) {
    return {
      status: 'INCONCLUSIVE_CHALLENGE_QUALIFICATION',
      totalQualifying,
      qualifyingPerClass: qualifyingPerClassCounts,
      qualifyingCases: [],
      nonqualifyingProvenance: nonqualifying,
    };
  }

  const qualifyingCases = [];
  let suiteOrderIndex = 1;
  for (const fc of R2_1_FAILURE_CLASSES) {
    for (const attempt of qualifyingByClass.get(fc)) {
      qualifyingCases.push({
        suiteOrderIndex: suiteOrderIndex++,
        attemptId: attempt.attemptId,
        failureClass: attempt.failureClass,
        attemptOrderIndex: attempt.attemptOrderIndex,
        casePacketHash: attempt.constructionArtifactHash || attempt.sourcePacketReferenceHash,
      });
    }
  }

  return {
    status: 'READY',
    totalQualifying: 12,
    qualifyingPerClass: qualifyingPerClassCounts,
    qualifyingCases,
    nonqualifyingProvenance: nonqualifying,
  };
}

/**
 * Recursively inspects an object for forbidden holdout content keys at any depth.
 */
function scanForForbiddenHoldoutKeys(obj, pathTrace = '$') {
  if (!obj || typeof obj !== 'object') return;
  for (const [key, value] of Object.entries(obj)) {
    if (FORBIDDEN_HOLDOUT_CONTENT_KEYS.includes(key)) {
      throw new Error(`SECURITY_VIOLATION: Replacement holdout commitment contains forbidden field '${key}' at ${pathTrace}.${key}`);
    }
    scanForForbiddenHoldoutKeys(value, `${pathTrace}.${key}`);
  }
}

/**
 * Canonical deterministic challenge execution-order encoding and hash recomputation.
 * Orders qualifyingCases by suiteOrderIndex ascending, projects to:
 * [ { suiteOrderIndex, attemptId, casePacketHash }, ... ]
 * and computes sha256:<digest> over canonical JSON string.
 */
export function computeChallengeExecutionOrderHash(qualifyingCases) {
  if (!Array.isArray(qualifyingCases) || qualifyingCases.length !== 12) {
    throw new Error(
      `computeChallengeExecutionOrderHash requires exactly 12 qualifying cases, got ${qualifyingCases?.length}`
    );
  }
  const sorted = [...qualifyingCases].sort((a, b) => a.suiteOrderIndex - b.suiteOrderIndex);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].suiteOrderIndex !== i + 1) {
      throw new Error(
        `Invalid or non-sequential suiteOrderIndex in qualifyingCases: expected ${i + 1}, got ${sorted[i].suiteOrderIndex}`
      );
    }
    if (!sorted[i].attemptId || typeof sorted[i].attemptId !== 'string') {
      throw new Error(`Missing or invalid attemptId in qualifying case at index ${i}`);
    }
    if (!sorted[i].casePacketHash || !/^sha256:[a-f0-9]{64}$/.test(sorted[i].casePacketHash)) {
      throw new Error(`Missing or invalid casePacketHash in qualifying case at index ${i}`);
    }
  }
  const projected = sorted.map((c) => ({
    suiteOrderIndex: c.suiteOrderIndex,
    attemptId: c.attemptId,
    casePacketHash: c.casePacketHash,
  }));
  const canonicalJson = JSON.stringify(projected);
  return 'sha256:' + computeSha256(Buffer.from(canonicalJson, 'utf8'));
}

/**
 * Computes canonical aggregate member reference set hash:
 * SHA256(canonical JSON of sorted unique opaque member-reference hashes).
 */
export function computeOpaqueMemberReferenceSetHash(memberHashes) {
  if (!Array.isArray(memberHashes) || memberHashes.length === 0) {
    throw new Error('computeOpaqueMemberReferenceSetHash requires a non-empty array of hashes');
  }
  const unique = new Set();
  for (const h of memberHashes) {
    if (typeof h !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(h)) {
      throw new Error(`Invalid member reference hash format: ${h}`);
    }
    if (unique.has(h)) {
      throw new Error(`Duplicate member reference hash in set: ${h}`);
    }
    unique.add(h);
  }
  const sorted = [...memberHashes].sort();
  const canonicalJson = JSON.stringify(sorted);
  return 'sha256:' + computeSha256(Buffer.from(canonicalJson, 'utf8'));
}

export const R2_1_DERIVATION_SCHEME = 'HMAC_SHA256_CANDIDATE_MEMBER_V1';
export const R2_1_DERIVATION_VERSION = '1';

/**
 * Derives an opaque candidate-member reference hash using the governed HMAC scheme:
 * HMAC-SHA256(secretKey, canonicalCandidateIdentity)
 */
export function deriveOpaqueMemberHmac(secretKey, candidateId) {
  if (!secretKey || typeof secretKey !== 'string') {
    throw new Error('deriveOpaqueMemberHmac requires a non-empty string secretKey');
  }
  if (typeof candidateId !== 'string' || !candidateId.trim()) {
    throw new Error('candidateId must be a non-empty string');
  }
  const hmac = crypto.createHmac('sha256', Buffer.from(secretKey, 'utf8'));
  hmac.update(candidateId.trim(), 'utf8');
  return 'sha256:' + hmac.digest('hex');
}

/**
 * Computes a cryptographic commitment to a custodian secret derivation key:
 * SHA256(secretKey)
 */
export function computeDerivationKeyCommitment(secretKey) {
  if (!secretKey || typeof secretKey !== 'string') {
    throw new Error('computeDerivationKeyCommitment requires a non-empty string secretKey');
  }
  return 'sha256:' + computeSha256(Buffer.from(secretKey, 'utf8'));
}

/**
 * Governed opaque member-reference derivation scheme.
 */
export function deriveOpaqueMemberHash(candidateId, scheme = R2_1_DERIVATION_SCHEME, secretKey = null) {
  if (typeof candidateId !== 'string' || !candidateId.trim()) {
    throw new Error('candidateId must be a non-empty string');
  }
  if (scheme === R2_1_DERIVATION_SCHEME) {
    if (!secretKey) {
      throw new Error(`derivationScheme ${R2_1_DERIVATION_SCHEME} requires secretKey`);
    }
    return deriveOpaqueMemberHmac(secretKey, candidateId);
  }
  if (scheme === 'sha256-prefixed-candidate-id-v1') {
    return 'sha256:' + computeSha256(Buffer.from(`verifier-v1.4-prohibited-cohort-member-v1:${candidateId.trim()}`, 'utf8'));
  }
  throw new Error(`Unsupported derivationScheme: ${scheme}`);
}

/**
 * Deterministically extracts unique candidate IDs from an authoritative cohort membership source.
 */
export function extractCandidateIdsFromSource(sourceObj) {
  let list;
  if (Array.isArray(sourceObj)) {
    list = sourceObj;
  } else if (sourceObj && typeof sourceObj === 'object') {
    list = sourceObj.candidates || sourceObj.candidateIds || sourceObj.members;
    if (!Array.isArray(list)) {
      throw new Error('Authoritative source object must contain a candidates, candidateIds, or members array');
    }
  } else {
    throw new Error('Authoritative source must be a JSON array or object');
  }

  const ids = list.map((item) => {
    if (typeof item === 'string' && item.trim()) return item.trim();
    if (item && typeof item === 'object') {
      const id = item.candidateId || item.id || item.movie_id;
      if (typeof id === 'string' && id.trim()) return id.trim();
    }
    throw new Error(`Unable to extract candidateId from item: ${JSON.stringify(item)}`);
  });

  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    throw new Error(`Authoritative source contains duplicate candidate IDs (found ${unique.size} unique across ${ids.length})`);
  }
  return ids;
}

/**
 * Deterministic Git checkpoint verifier for EXECUTION_READY freeze records.
 * Fails closed unless:
 * 1. workspaceRoot is inside a git repository.
 * 2. commitSha exists as a commit object (`git cat-file -e <sha>^{commit}`).
 * 3. commitSha is an ancestor of HEAD (`git merge-base --is-ancestor <sha> HEAD`).
 * 4. toolchain manifest exists at that commit and matches expectedToolchainSha.
 * 5. Every file listed in toolchain manifest exists at that commit and matches its committed hash.
 */
export function verifyFreezePreparationCheckpointCommit({
  commitSha,
  workspaceRoot,
  toolchainManifest,
  expectedToolchainSha,
  toolchainManifestRelPath = 'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/freeze-preparation-manifest.v1.json',
}) {
  if (!commitSha || typeof commitSha !== 'string' || !/^[a-f0-9]{40}$/.test(commitSha)) {
    throw new Error(`Invalid Git commit SHA: ${commitSha}`);
  }
  if (!workspaceRoot || typeof workspaceRoot !== 'string' || !fs.existsSync(workspaceRoot)) {
    throw new Error(`Invalid workspaceRoot: ${workspaceRoot}`);
  }

  // 1. Verify workspaceRoot is inside git repo
  try {
    execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    throw new Error(`workspaceRoot (${workspaceRoot}) is not inside a Git repository: ${err.message}`);
  }

  // 2. Verify commitSha exists as a commit object
  try {
    execFileSync('git', ['cat-file', '-e', `${commitSha}^{commit}`], {
      cwd: workspaceRoot,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (err) {
    throw new Error(`Checkpoint commit ${commitSha} does not exist as a commit object in repository history: ${err.message}`);
  }

  // 3. Verify commitSha is an ancestor of HEAD
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commitSha, 'HEAD'], {
      cwd: workspaceRoot,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (err) {
    throw new Error(`Checkpoint commit ${commitSha} is not an ancestor of current HEAD: ${err.message}`);
  }

  // 4. Verify freeze-preparation-manifest artifact itself at that commit
  let manifestBytes;
  try {
    manifestBytes = execFileSync('git', ['show', `${commitSha}:${toolchainManifestRelPath}`], {
      cwd: workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    throw new Error(
      `Toolchain manifest artifact ${toolchainManifestRelPath} does not exist at checkpoint commit ${commitSha}: ${err.message}`
    );
  }

  const manifestActualSha = 'sha256:' + computeSha256(manifestBytes);
  if (expectedToolchainSha && manifestActualSha !== expectedToolchainSha) {
    throw new Error(
      `Toolchain manifest at checkpoint commit ${commitSha} hash mismatch: expected ${expectedToolchainSha}, got ${manifestActualSha}`
    );
  }

  // 5. Verify every file listed in toolchainManifest exists at that commit and matches committed hash
  if (!toolchainManifest || typeof toolchainManifest !== 'object' || !toolchainManifest.toolchainFiles) {
    throw new Error('toolchainManifest with toolchainFiles mapping is required for checkpoint verification');
  }
  if ('governedFiles' in toolchainManifest) {
    throw new Error('toolchainManifest contains legacy or redundant governedFiles mapping; only toolchainFiles is permitted');
  }

  for (const [filePath, expectedFileSha] of Object.entries(toolchainManifest.toolchainFiles)) {
    let fileBytes;
    try {
      fileBytes = execFileSync('git', ['show', `${commitSha}:${filePath}`], {
        cwd: workspaceRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 20 * 1024 * 1024,
      });
    } catch (err) {
      throw new Error(`Governed toolchain file ${filePath} does not exist at checkpoint commit ${commitSha}: ${err.message}`);
    }
    const actualFileSha = 'sha256:' + computeSha256(fileBytes);
    if (actualFileSha !== expectedFileSha) {
      throw new Error(
        `Governed toolchain file ${filePath} at checkpoint commit ${commitSha} SHA-256 mismatch: expected ${expectedFileSha}, got ${actualFileSha}`
      );
    }
  }

  return {
    verified: true,
    commitSha,
  };
}

/**
 * Validates a replacement holdout commitment artifact.
 * Enforces content-free isolation: prohibits any movie/candidate IDs, titles, or editorial content.
 * Enforces candidateCount >= 100 to support prospective natural arm stopping requirements.
 */
export function validateReplacementHoldoutCommitment(commitment) {
  if (!commitment || typeof commitment !== 'object') {
    throw new Error('Replacement holdout commitment must be an object');
  }

  scanForForbiddenHoldoutKeys(commitment);

  const required = [
    'schemaVersion',
    'commitmentId',
    'protocolId',
    'opaqueMembershipHash',
    'opaqueMemberReferenceSetHash',
    'deterministicOrderHash',
    'candidateCount',
    'derivationScheme',
    'derivationVersion',
    'derivationKeyCommitment',
    'sealingMethod',
    'sealingVersion',
    'custodianId',
    'sealedAt',
    'integrityStatus',
  ];

  for (const field of required) {
    if (commitment[field] === undefined) {
      throw new Error(`Replacement holdout commitment missing required field: ${field}`);
    }
  }

  if (typeof commitment.candidateCount !== 'number' || commitment.candidateCount < 100) {
    throw new Error(`candidateCount must be at least 100, got ${commitment.candidateCount}`);
  }

  if (commitment.derivationScheme !== R2_1_DERIVATION_SCHEME) {
    throw new Error(`Replacement holdout derivationScheme mismatch: expected ${R2_1_DERIVATION_SCHEME}, got ${commitment.derivationScheme}`);
  }

  if (commitment.derivationVersion !== R2_1_DERIVATION_VERSION) {
    throw new Error(`Replacement holdout derivationVersion mismatch: expected ${R2_1_DERIVATION_VERSION}, got ${commitment.derivationVersion}`);
  }

  if (!/^sha256:[a-f0-9]{64}$/.test(commitment.derivationKeyCommitment)) {
    throw new Error(`Invalid derivationKeyCommitment format: ${commitment.derivationKeyCommitment}`);
  }

  if (!/^sha256:[a-f0-9]{64}$/.test(commitment.opaqueMemberReferenceSetHash)) {
    throw new Error(`Invalid opaqueMemberReferenceSetHash format: ${commitment.opaqueMemberReferenceSetHash}`);
  }

  return true;
}

/**
 * Validates challenge source exclusion proof establishing disjointness from prohibited cohorts.
 */
export function validateChallengeSourceExclusion(exclusionDoc) {
  if (!exclusionDoc || typeof exclusionDoc !== 'object') {
    throw new Error('Challenge source exclusion manifest must be an object');
  }
  if (exclusionDoc.schemaVersion !== 'challenge-source-exclusion.v1') {
    throw new Error(`Unexpected schemaVersion in exclusion manifest: ${exclusionDoc.schemaVersion}`);
  }
  if (exclusionDoc.protocolId !== 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1') {
    throw new Error(`Unexpected protocolId in exclusion manifest: ${exclusionDoc.protocolId}`);
  }
  if (exclusionDoc.derivationScheme !== R2_1_DERIVATION_SCHEME) {
    throw new Error(`Exclusion manifest derivationScheme mismatch: expected ${R2_1_DERIVATION_SCHEME}, got ${exclusionDoc.derivationScheme}`);
  }
  if (exclusionDoc.derivationVersion !== R2_1_DERIVATION_VERSION) {
    throw new Error(`Exclusion manifest derivationVersion mismatch: expected ${R2_1_DERIVATION_VERSION}, got ${exclusionDoc.derivationVersion}`);
  }
  if (!exclusionDoc.derivationKeyCommitment || !/^sha256:[a-f0-9]{64}$/.test(exclusionDoc.derivationKeyCommitment)) {
    throw new Error(`Exclusion manifest invalid derivationKeyCommitment: ${exclusionDoc.derivationKeyCommitment}`);
  }

  if (!Array.isArray(exclusionDoc.challengeSourceMemberHashes) || exclusionDoc.challengeSourceMemberHashes.length < 18) {
    throw new Error(`challengeSourceMemberHashes must contain at least 18 entries, got ${exclusionDoc.challengeSourceMemberHashes?.length}`);
  }

  const sourceSet = new Set(exclusionDoc.challengeSourceMemberHashes);
  if (sourceSet.size !== exclusionDoc.challengeSourceMemberHashes.length) {
    throw new Error('challengeSourceMemberHashes contains duplicate hashes');
  }

  const prohibited = exclusionDoc.prohibitedCohorts;
  if (!prohibited || typeof prohibited !== 'object') {
    throw new Error('Missing prohibitedCohorts in challenge source exclusion manifest');
  }

  const nonSecretCohorts = [
    'developmentCohort',
    'retrospectiveV14Cohort',
    'currentProductionCohort',
  ];

  for (const cohortKey of nonSecretCohorts) {
    const cohort = prohibited[cohortKey];
    if (!cohort || typeof cohort !== 'object') {
      throw new Error(`Missing prohibited cohort '${cohortKey}'`);
    }
    const smc = cohort.sourceMembershipCommitment;
    if (!smc || typeof smc !== 'object') {
      throw new Error(`Prohibited cohort '${cohortKey}' missing sourceMembershipCommitment`);
    }
    if (!smc.path || typeof smc.path !== 'string') {
      throw new Error(`Prohibited cohort '${cohortKey}' sourceMembershipCommitment missing path`);
    }
    if (!smc.sha256 || !/^sha256:[a-f0-9]{64}$/.test(smc.sha256)) {
      throw new Error(`Prohibited cohort '${cohortKey}' sourceMembershipCommitment invalid sha256: ${smc.sha256}`);
    }
    if (!Number.isInteger(smc.candidateCount) || smc.candidateCount < 1) {
      throw new Error(`Prohibited cohort '${cohortKey}' candidateCount must be integer >= 1, got ${smc.candidateCount}`);
    }
    if (!smc.derivationScheme || typeof smc.derivationScheme !== 'string') {
      throw new Error(`Prohibited cohort '${cohortKey}' sourceMembershipCommitment missing derivationScheme`);
    }
    if (smc.derivationScheme !== exclusionDoc.derivationScheme) {
      throw new Error(`Prohibited cohort '${cohortKey}' sourceMembershipCommitment derivationScheme mismatch: expected ${exclusionDoc.derivationScheme}, got ${smc.derivationScheme}`);
    }
    if (!smc.derivationVersion || typeof smc.derivationVersion !== 'string') {
      throw new Error(`Prohibited cohort '${cohortKey}' sourceMembershipCommitment missing derivationVersion`);
    }
    if (smc.derivationVersion !== exclusionDoc.derivationVersion) {
      throw new Error(`Prohibited cohort '${cohortKey}' sourceMembershipCommitment derivationVersion mismatch: expected ${exclusionDoc.derivationVersion}, got ${smc.derivationVersion}`);
    }
    if (smc.derivationKeyCommitment && smc.derivationKeyCommitment !== exclusionDoc.derivationKeyCommitment) {
      throw new Error(`Prohibited cohort '${cohortKey}' sourceMembershipCommitment derivationKeyCommitment mismatch: expected ${exclusionDoc.derivationKeyCommitment}, got ${smc.derivationKeyCommitment}`);
    }
    if (cohort.derivationScheme && cohort.derivationScheme !== exclusionDoc.derivationScheme) {
      throw new Error(`Prohibited cohort '${cohortKey}' derivationScheme mismatch: expected ${exclusionDoc.derivationScheme}, got ${cohort.derivationScheme}`);
    }
    if (cohort.derivationVersion && cohort.derivationVersion !== exclusionDoc.derivationVersion) {
      throw new Error(`Prohibited cohort '${cohortKey}' derivationVersion mismatch: expected ${exclusionDoc.derivationVersion}, got ${cohort.derivationVersion}`);
    }
    if (cohort.derivationKeyCommitment && cohort.derivationKeyCommitment !== exclusionDoc.derivationKeyCommitment) {
      throw new Error(`Prohibited cohort '${cohortKey}' derivationKeyCommitment mismatch: expected ${exclusionDoc.derivationKeyCommitment}, got ${cohort.derivationKeyCommitment}`);
    }

    if (!Array.isArray(cohort.opaqueMemberHashes) || cohort.opaqueMemberHashes.length !== smc.candidateCount) {
      throw new Error(
        `Prohibited cohort '${cohortKey}' opaqueMemberHashes length (${cohort.opaqueMemberHashes?.length}) must equal candidateCount (${smc.candidateCount})`
      );
    }
    const cohortSet = new Set(cohort.opaqueMemberHashes);
    if (cohortSet.size !== cohort.opaqueMemberHashes.length) {
      throw new Error(`Prohibited cohort '${cohortKey}' contains duplicate opaqueMemberHashes`);
    }
    for (const h of cohort.opaqueMemberHashes) {
      if (sourceSet.has(h)) {
        throw new Error(`EXCLUSION_VIOLATION: Prohibited cohort '${cohortKey}' member hash ${h} collides with challenge source pool`);
      }
    }
  }

  // Check replacementProspectiveHoldout
  const holdoutCohort = prohibited.replacementProspectiveHoldout;
  if (!holdoutCohort || typeof holdoutCohort !== 'object') {
    throw new Error('Missing replacementProspectiveHoldout in prohibitedCohorts');
  }
  if (!Number.isInteger(holdoutCohort.candidateCount) || holdoutCohort.candidateCount < 100) {
    throw new Error(`replacementProspectiveHoldout candidateCount must be integer >= 100, got ${holdoutCohort.candidateCount}`);
  }
  if (holdoutCohort.derivationScheme && holdoutCohort.derivationScheme !== exclusionDoc.derivationScheme) {
    throw new Error(`replacementProspectiveHoldout derivationScheme mismatch: expected ${exclusionDoc.derivationScheme}, got ${holdoutCohort.derivationScheme}`);
  }
  if (holdoutCohort.derivationVersion && holdoutCohort.derivationVersion !== exclusionDoc.derivationVersion) {
    throw new Error(`replacementProspectiveHoldout derivationVersion mismatch: expected ${exclusionDoc.derivationVersion}, got ${holdoutCohort.derivationVersion}`);
  }
  if (holdoutCohort.derivationKeyCommitment && holdoutCohort.derivationKeyCommitment !== exclusionDoc.derivationKeyCommitment) {
    throw new Error(`replacementProspectiveHoldout derivationKeyCommitment mismatch: expected ${exclusionDoc.derivationKeyCommitment}, got ${holdoutCohort.derivationKeyCommitment}`);
  }
  if (!Array.isArray(holdoutCohort.opaqueMemberHashes) || holdoutCohort.opaqueMemberHashes.length !== holdoutCohort.candidateCount) {
    throw new Error(
      `replacementProspectiveHoldout opaqueMemberHashes length (${holdoutCohort.opaqueMemberHashes?.length}) must equal candidateCount (${holdoutCohort.candidateCount})`
    );
  }
  const holdoutSet = new Set(holdoutCohort.opaqueMemberHashes);
  if (holdoutSet.size !== holdoutCohort.opaqueMemberHashes.length) {
    throw new Error('replacementProspectiveHoldout contains duplicate opaqueMemberHashes');
  }
  for (const h of holdoutCohort.opaqueMemberHashes) {
    if (sourceSet.has(h)) {
      throw new Error(`EXCLUSION_VIOLATION: replacementProspectiveHoldout member hash ${h} collides with challenge source pool`);
    }
  }

  if (exclusionDoc.exclusionVerificationStatus !== 'DISJOINT_EXCLUSION_PROVEN') {
    throw new Error(`exclusionVerificationStatus must be DISJOINT_EXCLUSION_PROVEN, got ${exclusionDoc.exclusionVerificationStatus}`);
  }

  return true;
}

/**
 * Validates human resource confirmation assignments.
 * Enforces exactly 8 distinct personnel and mutual independence.
 */
export function validateHumanResourceConfirmation(confirmation) {
  if (!confirmation || typeof confirmation !== 'object') {
    throw new Error('Human resource confirmation must be an object');
  }

  const assignments = confirmation.roleAssignments;
  if (!assignments || typeof assignments !== 'object') {
    throw new Error('Missing roleAssignments object');
  }

  for (const role of R2_1_HUMAN_ROLES) {
    if (!assignments[role] || typeof assignments[role] !== 'string') {
      throw new Error(`Missing role assignment for: ${role}`);
    }
  }

  const personnelIds = R2_1_HUMAN_ROLES.map((role) => assignments[role]);
  const uniquePersonnel = new Set(personnelIds);

  if (uniquePersonnel.size !== 8) {
    throw new Error(
      `Human resource confirmation requires exactly 8 distinct personnel; found ${uniquePersonnel.size} unique IDs across 8 roles`
    );
  }

  if (assignments.independent_custodian === assignments.verifier_operator) {
    throw new Error('INDEPENDENCE_VIOLATION: Custodian cannot be Verifier Operator');
  }
  if (
    assignments.challenge_construction_author === assignments.challenge_adjudicator_A ||
    assignments.challenge_construction_author === assignments.challenge_adjudicator_B
  ) {
    throw new Error('INDEPENDENCE_VIOLATION: Challenge construction author cannot adjudicate challenges');
  }
  if (assignments.challenge_adjudicator_A === assignments.challenge_adjudicator_B) {
    throw new Error('INDEPENDENCE_VIOLATION: Challenge adjudicator A and B must be distinct');
  }
  if (assignments.natural_primary_adjudicator === assignments.natural_QA_adjudicator) {
    throw new Error('INDEPENDENCE_VIOLATION: Natural primary and QA adjudicators must be distinct');
  }
  if (
    assignments.natural_reconciliation_adjudicator === assignments.natural_primary_adjudicator ||
    assignments.natural_reconciliation_adjudicator === assignments.natural_QA_adjudicator
  ) {
    throw new Error('INDEPENDENCE_VIOLATION: Reconciliation adjudicator cannot be primary or QA');
  }
  if (
    assignments.independent_custodian === assignments.natural_primary_adjudicator ||
    assignments.independent_custodian === assignments.natural_QA_adjudicator ||
    assignments.independent_custodian === assignments.natural_reconciliation_adjudicator
  ) {
    throw new Error('INDEPENDENCE_VIOLATION: Custodian cannot adjudicate');
  }
  if (
    assignments.verifier_operator === assignments.natural_primary_adjudicator ||
    assignments.verifier_operator === assignments.natural_QA_adjudicator ||
    assignments.verifier_operator === assignments.natural_reconciliation_adjudicator
  ) {
    throw new Error('INDEPENDENCE_VIOLATION: Verifier operator cannot adjudicate');
  }

  return true;
}

function loadAndValidateSchema(data, schemaRelativePath, workspaceRoot, description) {
  const schemaResolved = resolveSafeWorkspacePath(schemaRelativePath, workspaceRoot);
  const schemaJson = JSON.parse(fs.readFileSync(schemaResolved, 'utf8'));
  validateJsonSchema(data, schemaJson, description);
  return schemaJson;
}

/**
 * Validates a future execution-freeze record against r2.1 protocol requirements.
 * Implements a strict 3-layer verification model:
 * 1. Byte / Hash Cryptographic Provenance
 * 2. Governed JSON Schema Enforcement
 * 3. Cross-Artifact Semantic Invariants
 */
export function validateProspectiveFreezeRecord(record, options = {}) {
  const { workspaceRoot = process.cwd(), requireExecutionReady = false } = options;

  if (!record || typeof record !== 'object') {
    throw new Error('Execution freeze record must be an object');
  }

  // 1. LAYER 2: Validate execution freeze record itself against its governed JSON Schema
  const freezeRecordSchemaPath =
    'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/execution-freeze-record.schema.v1.json';
  loadAndValidateSchema(record, freezeRecordSchemaPath, workspaceRoot, 'executionFreezeRecord');

  const requiredFields = [
    'schemaVersion',
    'freezeId',
    'protocolId',
    'status',
    'governanceAuthority',
    'protocolCommitment',
    'manifestCommitment',
    'replacementHoldoutCommitment',
    'qaSeedCommitment',
    'challengePoolAndExclusionCommitment',
    'challengeAttemptManifestCommitment',
    'challengeTransformationSpecCommitment',
    'challengeQualificationManifestCommitment',
    'runtimeDependencyDeclarationCommitment',
    'analysisPlanCommitment',
    'operatorLogSchemaCommitment',
    'fixedExecutionOrderCommitment',
    'humanResourceConfirmationCommitment',
    'frozenModelConfigurationCommitment',
    'inputContractCommitments',
    'freezeValidationToolchainCommitment',
    'freezePreparationCheckpointCommit',
    'freezeMetadata',
  ];

  for (const field of requiredFields) {
    if (record[field] === undefined) {
      throw new Error(`Execution freeze record missing required field: ${field}`);
    }
  }

  if (record.schemaVersion !== 'execution-freeze-record.v1') {
    throw new Error(`Unexpected schemaVersion: ${record.schemaVersion}`);
  }

  if (record.protocolId !== 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1') {
    throw new Error(`Unexpected protocolId: ${record.protocolId}`);
  }

  // Check Protocol and Manifest claimed SHAs
  const protocolSha = record.protocolCommitment?.sha256?.replace(/^sha256:/, '');
  if (protocolSha !== R2_1_PROTOCOL_SHA256) {
    throw new Error(`Protocol SHA mismatch: expected ${R2_1_PROTOCOL_SHA256}, got ${protocolSha}`);
  }
  if (record.protocolCommitment.path !== R2_1_PROTOCOL_PATH) {
    throw new Error(`Protocol path mismatch: expected ${R2_1_PROTOCOL_PATH}, got ${record.protocolCommitment.path}`);
  }

  const manifestSha = record.manifestCommitment?.sha256?.replace(/^sha256:/, '');
  if (manifestSha !== R2_1_MANIFEST_SHA256) {
    throw new Error(`Manifest SHA mismatch: expected ${R2_1_MANIFEST_SHA256}, got ${manifestSha}`);
  }
  if (record.manifestCommitment.path !== R2_1_MANIFEST_PATH) {
    throw new Error(`Manifest path mismatch: expected ${R2_1_MANIFEST_PATH}, got ${record.manifestCommitment.path}`);
  }

  // Model & Configuration Freeze
  const modelConfig = record.frozenModelConfigurationCommitment;
  if (!modelConfig) throw new Error('Missing frozenModelConfigurationCommitment');

  if (modelConfig.provider !== 'google-gemini-developer-api') {
    throw new Error(`Model provider mismatch: expected google-gemini-developer-api, got ${modelConfig.provider}`);
  }
  if (modelConfig.modelId !== 'gemini-3.8-flash') {
    throw new Error(`Model ID mismatch: expected gemini-3.8-flash, got ${modelConfig.modelId}`);
  }
  if (modelConfig.thinkingLevel !== 'low') {
    throw new Error(`Thinking level mismatch: expected low, got ${modelConfig.thinkingLevel}`);
  }
  if (modelConfig.temperature !== 0.0) {
    throw new Error(`Temperature mismatch: expected 0.0, got ${modelConfig.temperature}`);
  }
  if (modelConfig.maxOutputTokens !== 6144) {
    throw new Error(`maxOutputTokens mismatch: expected 6144, got ${modelConfig.maxOutputTokens}`);
  }
  if (modelConfig.timeoutMs !== 30000) {
    throw new Error(`timeoutMs mismatch: expected 30000, got ${modelConfig.timeoutMs}`);
  }
  if (modelConfig.automaticRetries !== 0) {
    throw new Error(`automaticRetries mismatch: expected 0, got ${modelConfig.automaticRetries}`);
  }
  if (modelConfig.fallbackProhibited !== true) {
    throw new Error('fallbackProhibited must be true');
  }

  // Input Contract Commitments shape checks
  const inputContracts = record.inputContractCommitments;
  if (!inputContracts) throw new Error('Missing inputContractCommitments');

  if (
    inputContracts.verifierInputBuilder?.path !== 'catalogue-pipeline/scripts/scaleTranche1Plan.mjs' ||
    inputContracts.verifierInputBuilder?.sha256 !==
      'sha256:de201c6695d8198aac7059ceab1e1630cca9db9448b68c62a93a46137e98287c'
  ) {
    throw new Error('verifierInputBuilder binding mismatch in inputContractCommitments');
  }

  if (
    inputContracts.surfaceAndLeakageContract?.path !==
      'catalogue-pipeline/scripts/runVerifierV13RetrospectiveReplay.mjs' ||
    inputContracts.surfaceAndLeakageContract?.sha256 !==
      'sha256:3976a45b6e0655599c97bb560d6463ff78715a68b676225d117113a5f7382690'
  ) {
    throw new Error('surfaceAndLeakageContract binding mismatch in inputContractCommitments');
  }

  if (
    inputContracts.blindPacketSchema?.path !==
      'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/blind-human-review-packet.schema.v1.json' ||
    inputContracts.blindPacketSchema?.sha256 !==
      'sha256:6bae3f04c4fc8d80d03e86adc389fb68a83b79098209b60fc498c59e0a4af257'
  ) {
    throw new Error('blindPacketSchema binding mismatch in inputContractCommitments');
  }

  if (
    !Array.isArray(inputContracts.requiredSurfaces) ||
    inputContracts.requiredSurfaces.length !== R2_1_REQUIRED_SURFACES.length ||
    !R2_1_REQUIRED_SURFACES.every((s) => inputContracts.requiredSurfaces.includes(s))
  ) {
    throw new Error('requiredSurfaces does not match frozen R2_1_REQUIRED_SURFACES');
  }

  // Fixed Execution Order Commitment
  const execOrder = record.fixedExecutionOrderCommitment;
  if (!execOrder) throw new Error('Missing fixedExecutionOrderCommitment');
  if (execOrder.interArmSequencing !== 'qualifying_challenges_first_then_natural_stream') {
    throw new Error(
      `interArmSequencing must be qualifying_challenges_first_then_natural_stream, got ${execOrder.interArmSequencing}`
    );
  }

  // Operator log retry rule
  if (record.operatorLogSchemaCommitment?.retryRule !== 'retryCount == 0') {
    throw new Error('operatorLogSchemaCommitment retryRule must be retryCount == 0');
  }

  // Analysis plan rate formula
  if (
    record.analysisPlanCommitment?.rateRuleFormula !==
    'errorCount <= floor(0.10 * realizedHumanLabelCount)'
  ) {
    throw new Error(
      'analysisPlanCommitment rateRuleFormula must be errorCount <= floor(0.10 * realizedHumanLabelCount)'
    );
  }

  // Check unresolved placeholders
  const stringified = JSON.stringify(record);
  const hasPlaceholders = stringified.includes('UNRESOLVED_PRE_EXECUTION_COMMITMENT');

  if (record.status === 'PREPARATION_TEMPLATE') {
    if (requireExecutionReady) {
      throw new Error('Freeze package is in PREPARATION_TEMPLATE status, but EXECUTION_READY is required');
    }
    if (!hasPlaceholders) {
      throw new Error(
        'Freeze package claims PREPARATION_TEMPLATE status but has no UNRESOLVED_PRE_EXECUTION_COMMITMENT placeholders'
      );
    }
    if (
      record.freezeMetadata?.custodianSignoffStatus !==
      'PENDING_SEALED_HOLDOUT_AND_RESOURCE_CONFIRMATION'
    ) {
      throw new Error(
        `PREPARATION_TEMPLATE must have custodianSignoffStatus PENDING_SEALED_HOLDOUT_AND_RESOURCE_CONFIRMATION, got ${record.freezeMetadata?.custodianSignoffStatus}`
      );
    }
    return {
      status: 'PREPARATION_TEMPLATE_VALID',
      isExecutionReady: false,
      message: 'Template is structurally valid, contains governed placeholders, and is pending holdout sealing and human assignment.',
    };
  }

  if (record.status !== 'EXECUTION_READY') {
    throw new Error(`Unknown freeze record status: ${record.status}`);
  }

  // =========================================================================
  // EXECUTION_READY VALIDATION (3 Layers)
  // =========================================================================

  if (hasPlaceholders) {
    throw new Error(
      'Freeze package claims EXECUTION_READY status but contains unresolved placeholders (UNRESOLVED_PRE_EXECUTION_COMMITMENT)'
    );
  }

  // External Governance Anchor Check (Gap 9)
  if (
    !record.freezePreparationCheckpointCommit ||
    typeof record.freezePreparationCheckpointCommit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(record.freezePreparationCheckpointCommit)
  ) {
    throw new Error(
      `EXECUTION_READY requires a valid 40-character hexadecimal freezePreparationCheckpointCommit Git commit SHA, got: ${record.freezePreparationCheckpointCommit}`
    );
  }

  // QA Seed Commitment Validation (Gap 7)
  const qaSeed = record.qaSeedCommitment;
  if (!qaSeed || typeof qaSeed !== 'object') {
    throw new Error('Missing qaSeedCommitment');
  }
  if (!qaSeed.qaSeedHash || !/^sha256:[a-f0-9]{64}$/.test(qaSeed.qaSeedHash)) {
    throw new Error(`EXECUTION_READY requires a valid sha256:<64hex> qaSeedHash, got: ${qaSeed.qaSeedHash}`);
  }
  if (qaSeed.status !== 'COMMITTED_BY_INDEPENDENT_CUSTODIAN') {
    throw new Error(`EXECUTION_READY requires qaSeedCommitment.status === 'COMMITTED_BY_INDEPENDENT_CUSTODIAN', got: ${qaSeed.status}`);
  }
  for (const rawSeedKey of ['rawSeed', 'seed', 'seedValue', 'secretSeed']) {
    if (qaSeed[rawSeedKey] !== undefined || record[rawSeedKey] !== undefined) {
      throw new Error(`SECURITY_VIOLATION: Raw QA seed value must not be exposed in freeze record (${rawSeedKey})`);
    }
  }

  const lintDisp = record.runtimeDependencyDeclarationCommitment?.deterministicLintFindings;
  if (lintDisp !== 'UNIVERSALLY_ABSENT' && lintDisp !== 'EXPLICITLY_BOUND_AND_FROZEN') {
    throw new Error(
      `deterministicLintFindings disposition must be UNIVERSALLY_ABSENT or EXPLICITLY_BOUND_AND_FROZEN, got ${lintDisp}`
    );
  }

  if (record.humanResourceConfirmationCommitment?.requiredDistinctPeople !== 8) {
    throw new Error('requiredDistinctPeople must be exactly 8');
  }

  if (record.challengeAttemptManifestCommitment?.totalAttempts !== 18) {
    throw new Error(
      `challengeAttemptManifestCommitment.totalAttempts must be 18, got ${record.challengeAttemptManifestCommitment?.totalAttempts}`
    );
  }

  if (record.challengeQualificationManifestCommitment?.totalQualifying !== 12) {
    throw new Error(
      `challengeQualificationManifestCommitment.totalQualifying must be 12, got ${record.challengeQualificationManifestCommitment?.totalQualifying}`
    );
  }

  // 1. Recompute and verify actual raw file bytes for Protocol and Manifest
  verifyCommittedFileSha256(record.protocolCommitment.path, record.protocolCommitment.sha256, workspaceRoot);
  verifyCommittedFileSha256(record.manifestCommitment.path, record.manifestCommitment.sha256, workspaceRoot);

  // 2. Source drift check: Recompute actual filesystem hashes for all 8 bound sources
  for (const [sourcePath, expectedSha] of Object.entries(R2_1_SOURCE_ARTIFACT_HASHES)) {
    verifyCommittedFileSha256(sourcePath, expectedSha, workspaceRoot);
  }

  // 3. Transformation Specification
  const transSpecRes = verifyCommittedFileSha256(
    record.challengeTransformationSpecCommitment.path,
    record.challengeTransformationSpecCommitment.sha256,
    workspaceRoot
  );
  const actualTransSpecSha = transSpecRes.actualSha256;

  // 4. Challenge Attempt Manifest
  const attemptManifestRes = verifyCommittedFileSha256(
    record.challengeAttemptManifestCommitment.path,
    record.challengeAttemptManifestCommitment.sha256,
    workspaceRoot
  );
  let attemptManifestJson;
  try {
    attemptManifestJson = JSON.parse(attemptManifestRes.rawBytes.toString('utf8'));
  } catch (err) {
    throw new Error(`Failed to parse challenge attempt manifest JSON: ${err.message}`);
  }

  loadAndValidateSchema(
    attemptManifestJson,
    'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/challenge-attempt-manifest.schema.v1.json',
    workspaceRoot,
    'challengeAttemptManifest'
  );

  if (attemptManifestJson.schemaVersion !== 'challenge-attempt-manifest.v1') {
    throw new Error(`Challenge attempt manifest schemaVersion mismatch: got ${attemptManifestJson.schemaVersion}`);
  }
  if (attemptManifestJson.protocolId !== 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1') {
    throw new Error(`Challenge attempt manifest protocolId mismatch: got ${attemptManifestJson.protocolId}`);
  }

  if (attemptManifestJson.totalAttempts !== 18 || !Array.isArray(attemptManifestJson.attempts) || attemptManifestJson.attempts.length !== 18) {
    throw new Error(
      `Challenge attempt manifest must contain exactly 18 attempts, found ${attemptManifestJson.attempts?.length}`
    );
  }

  // Ensure every attempt record in the actual file uses the frozen transformation-spec SHA
  for (const attempt of attemptManifestJson.attempts) {
    if (attempt.transformationSpecHash !== actualTransSpecSha) {
      throw new Error(
        `Attempt ${attempt.attemptId} transformationSpecHash (${attempt.transformationSpecHash}) does not match frozen transformation specification SHA (${actualTransSpecSha})`
      );
    }
  }

  // Evaluate challenge arm qualification on actual attempts
  const challengeEval = evaluateChallengeArmQualification(attemptManifestJson.attempts);
  if (challengeEval.status !== 'READY' || challengeEval.totalQualifying !== 12) {
    throw new Error(
      `Challenge qualification evaluated to ${challengeEval.status} with ${challengeEval.totalQualifying} qualifying cases; EXECUTION_READY requires READY with exactly 12 cases`
    );
  }

  // 5. Challenge Qualification Manifest
  const qualManifestRes = verifyCommittedFileSha256(
    record.challengeQualificationManifestCommitment.path,
    record.challengeQualificationManifestCommitment.sha256,
    workspaceRoot
  );
  let qualManifestJson;
  try {
    qualManifestJson = JSON.parse(qualManifestRes.rawBytes.toString('utf8'));
  } catch (err) {
    throw new Error(`Failed to parse challenge qualification manifest JSON: ${err.message}`);
  }

  loadAndValidateSchema(
    qualManifestJson,
    'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/challenge-qualification-manifest.schema.v1.json',
    workspaceRoot,
    'challengeQualificationManifest'
  );

  if (qualManifestJson.schemaVersion !== 'challenge-qualification-manifest.v1') {
    throw new Error(`Challenge qualification manifest schemaVersion mismatch: got ${qualManifestJson.schemaVersion}`);
  }
  if (qualManifestJson.protocolId !== 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1') {
    throw new Error(`Challenge qualification manifest protocolId mismatch: got ${qualManifestJson.protocolId}`);
  }

  if (qualManifestJson.attemptManifestPath !== record.challengeAttemptManifestCommitment.path) {
    throw new Error(
      `Qualification manifest attemptManifestPath mismatch: expected ${record.challengeAttemptManifestCommitment.path}, got ${qualManifestJson.attemptManifestPath}`
    );
  }

  if (qualManifestJson.attemptManifestSha256 !== record.challengeAttemptManifestCommitment.sha256) {
    throw new Error(
      `Qualification manifest attemptManifestSha256 mismatch: expected ${record.challengeAttemptManifestCommitment.sha256}, got ${qualManifestJson.attemptManifestSha256}`
    );
  }

  if (qualManifestJson.qualificationStatus !== 'READY') {
    throw new Error(
      `Qualification manifest status must be READY, got ${qualManifestJson.qualificationStatus}`
    );
  }

  if (qualManifestJson.totalQualifying !== 12) {
    throw new Error(
      `Qualification manifest totalQualifying must be 12, got ${qualManifestJson.totalQualifying}`
    );
  }

  if (qualManifestJson.thirdHumanRescue !== false) {
    throw new Error('thirdHumanRescue in challenge qualification manifest must be false');
  }

  if (!Array.isArray(qualManifestJson.qualifyingCases) || qualManifestJson.qualifyingCases.length !== 12) {
    throw new Error(
      `qualifyingCases in qualification manifest must contain exactly 12 cases, got ${qualManifestJson.qualifyingCases?.length}`
    );
  }

  // Cross-check actual qualifying cases against mechanical recomputation (including casePacketHash - Gap 3)
  for (let i = 0; i < 12; i++) {
    const expected = challengeEval.qualifyingCases[i];
    const actual = qualManifestJson.qualifyingCases[i];
    if (
      actual.suiteOrderIndex !== expected.suiteOrderIndex ||
      actual.attemptId !== expected.attemptId ||
      actual.failureClass !== expected.failureClass ||
      actual.attemptOrderIndex !== expected.attemptOrderIndex ||
      actual.casePacketHash !== expected.casePacketHash
    ) {
      throw new Error(
        `Qualifying case at index ${i} does not match deterministic first-four recomputation. Expected attemptId=${expected.attemptId}, order=${expected.attemptOrderIndex}, casePacketHash=${expected.casePacketHash}; got attemptId=${actual.attemptId}, order=${actual.attemptOrderIndex}, casePacketHash=${actual.casePacketHash}`
      );
    }
  }

  // Cross-check nonqualifying provenance against mechanical recomputation (Gap 4)
  if (
    !Array.isArray(qualManifestJson.nonqualifyingProvenance) ||
    qualManifestJson.nonqualifyingProvenance.length !== challengeEval.nonqualifyingProvenance.length
  ) {
    throw new Error(
      `Qualification manifest nonqualifyingProvenance length mismatch: expected ${challengeEval.nonqualifyingProvenance.length}, got ${qualManifestJson.nonqualifyingProvenance?.length}`
    );
  }
  for (let i = 0; i < challengeEval.nonqualifyingProvenance.length; i++) {
    const expected = challengeEval.nonqualifyingProvenance[i];
    const actual = qualManifestJson.nonqualifyingProvenance[i];
    if (
      actual.attemptId !== expected.attemptId ||
      actual.failureClass !== expected.failureClass ||
      actual.attemptOrderIndex !== expected.attemptOrderIndex ||
      actual.dispositionReason !== expected.dispositionReason
    ) {
      throw new Error(
        `Nonqualifying provenance entry at index ${i} does not match deterministic recomputation. Expected attemptId=${expected.attemptId}, class=${expected.failureClass}, order=${expected.attemptOrderIndex}, reason=${expected.dispositionReason}; got attemptId=${actual.attemptId}, class=${actual.failureClass}, order=${actual.attemptOrderIndex}, reason=${actual.dispositionReason}`
      );
    }
  }

  // Cross-check challenge execution order hash (Gap C)
  const expectedChallengeOrderHash = computeChallengeExecutionOrderHash(challengeEval.qualifyingCases);
  if (record.fixedExecutionOrderCommitment.challengeOrderHash !== expectedChallengeOrderHash) {
    throw new Error(
      `challengeOrderHash mismatch: freeze record has ${record.fixedExecutionOrderCommitment.challengeOrderHash}, recomputed value is ${expectedChallengeOrderHash}`
    );
  }

  // 6. Challenge Pool and Exclusion Manifest (Gap 5, Gap B, Gap B2)
  const poolRes = verifyCommittedFileSha256(
    record.challengePoolAndExclusionCommitment.path,
    record.challengePoolAndExclusionCommitment.sha256,
    workspaceRoot
  );
  let exclusionJson;
  try {
    exclusionJson = JSON.parse(poolRes.rawBytes.toString('utf8'));
  } catch (err) {
    throw new Error(`Failed to parse challenge pool exclusion JSON: ${err.message}`);
  }

  loadAndValidateSchema(
    exclusionJson,
    'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/challenge-source-exclusion.schema.v1.json',
    workspaceRoot,
    'challengeSourceExclusion'
  );

  validateChallengeSourceExclusion(exclusionJson);

  // Issue 2: Candidate-member reference binding for challenge attempts
  const attemptMemberHashes = attemptManifestJson.attempts.map((a) => {
    const candRef = a.sourceCandidateMemberReferenceHash || a.sourcePacketReferenceHash;
    if (!candRef || !/^sha256:[a-f0-9]{64}$/.test(candRef)) {
      throw new Error(`Challenge attempt ${a.attemptId} missing valid candidate-member reference`);
    }
    return candRef;
  });
  const distinctAttemptSources = new Set(attemptMemberHashes);
  if (distinctAttemptSources.size !== 18) {
    throw new Error(
      `Challenge attempts must use exactly 18 distinct sourceCandidateMemberReferenceHash values, found ${distinctAttemptSources.size}`
    );
  }
  const poolSourceSet = new Set(exclusionJson.challengeSourceMemberHashes);
  for (const attempt of attemptManifestJson.attempts) {
    const candRef = attempt.sourceCandidateMemberReferenceHash || attempt.sourcePacketReferenceHash;
    if (!poolSourceSet.has(candRef)) {
      throw new Error(
        `Challenge attempt ${attempt.attemptId} candidate-member reference ${candRef} is not present in exclusion-proven challengeSourceMemberHashes`
      );
    }
  }

  // Prohibited cohorts authenticity: ground non-secret prohibited cohorts against authoritative membership sources
  const nonSecretCohorts = [
    'developmentCohort',
    'retrospectiveV14Cohort',
    'currentProductionCohort',
  ];
  for (const cohortKey of nonSecretCohorts) {
    const cohort = exclusionJson.prohibitedCohorts[cohortKey];
    const srcRes = verifyCommittedFileSha256(
      cohort.sourceMembershipCommitment.path,
      cohort.sourceMembershipCommitment.sha256,
      workspaceRoot
    );
    let srcJson;
    try {
      srcJson = JSON.parse(srcRes.rawBytes.toString('utf8'));
    } catch (err) {
      throw new Error(`Failed to parse authoritative source JSON for cohort '${cohortKey}': ${err.message}`);
    }
    const candidateIds = extractCandidateIdsFromSource(srcJson);
    if (candidateIds.length !== cohort.sourceMembershipCommitment.candidateCount) {
      throw new Error(
        `Cohort '${cohortKey}' candidate count mismatch: source file has ${candidateIds.length}, commitment claims ${cohort.sourceMembershipCommitment.candidateCount}`
      );
    }
    if (cohort.opaqueMemberHashes.length !== cohort.sourceMembershipCommitment.candidateCount) {
      throw new Error(
        `Cohort '${cohortKey}' opaqueMemberHashes length (${cohort.opaqueMemberHashes.length}) must equal candidateCount (${cohort.sourceMembershipCommitment.candidateCount})`
      );
    }
    const uniqueCohortHashes = new Set(cohort.opaqueMemberHashes);
    if (uniqueCohortHashes.size !== cohort.opaqueMemberHashes.length) {
      throw new Error(`Cohort '${cohortKey}' contains duplicate opaqueMemberHashes`);
    }
  }

  // 7. Replacement Holdout Commitment (Gap 6, Gap B2)
  const holdoutRes = verifyCommittedFileSha256(
    record.replacementHoldoutCommitment.path,
    record.replacementHoldoutCommitment.sha256,
    workspaceRoot
  );
  let holdoutJson;
  try {
    holdoutJson = JSON.parse(holdoutRes.rawBytes.toString('utf8'));
  } catch (err) {
    throw new Error(`Failed to parse replacement holdout commitment JSON: ${err.message}`);
  }

  loadAndValidateSchema(
    holdoutJson,
    'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/replacement-holdout-commitment.schema.v1.json',
    workspaceRoot,
    'replacementHoldoutCommitment'
  );

  validateReplacementHoldoutCommitment(holdoutJson);

  if (holdoutJson.schemaVersion !== 'replacement-holdout-commitment.v1') {
    throw new Error(`Holdout commitment schemaVersion mismatch: got ${holdoutJson.schemaVersion}`);
  }
  if (holdoutJson.protocolId !== 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1') {
    throw new Error(`Holdout commitment protocolId mismatch: got ${holdoutJson.protocolId}`);
  }

  if (record.replacementHoldoutCommitment.opaqueMembershipHash !== holdoutJson.opaqueMembershipHash) {
    throw new Error('Holdout commitment opaqueMembershipHash mismatch between freeze record and artifact');
  }
  if (record.replacementHoldoutCommitment.opaqueMemberReferenceSetHash !== holdoutJson.opaqueMemberReferenceSetHash) {
    throw new Error('Holdout commitment opaqueMemberReferenceSetHash mismatch between freeze record and artifact');
  }
  if (record.replacementHoldoutCommitment.deterministicOrderHash !== holdoutJson.deterministicOrderHash) {
    throw new Error('Holdout commitment deterministicOrderHash mismatch between freeze record and artifact');
  }
  if (record.replacementHoldoutCommitment.candidateCount !== holdoutJson.candidateCount) {
    throw new Error('Holdout commitment candidateCount mismatch between freeze record and artifact');
  }
  if (record.replacementHoldoutCommitment.sealingMethod !== holdoutJson.sealingMethod) {
    throw new Error('Holdout commitment sealingMethod mismatch between freeze record and artifact');
  }
  if (record.fixedExecutionOrderCommitment.naturalOrderHash !== holdoutJson.deterministicOrderHash) {
    throw new Error(
      `naturalOrderHash (${record.fixedExecutionOrderCommitment.naturalOrderHash}) does not match holdout deterministicOrderHash (${holdoutJson.deterministicOrderHash})`
    );
  }

  // Common derivation domain check between replacement holdout and exclusion manifest
  if (holdoutJson.derivationScheme !== exclusionJson.derivationScheme) {
    throw new Error(
      `Derivation scheme mismatch: holdout has ${holdoutJson.derivationScheme}, exclusion manifest has ${exclusionJson.derivationScheme}`
    );
  }
  if (holdoutJson.derivationVersion !== exclusionJson.derivationVersion) {
    throw new Error(
      `Derivation version mismatch: holdout has ${holdoutJson.derivationVersion}, exclusion manifest has ${exclusionJson.derivationVersion}`
    );
  }
  if (holdoutJson.derivationKeyCommitment !== exclusionJson.derivationKeyCommitment) {
    throw new Error(
      `Derivation key commitment mismatch: holdout has ${holdoutJson.derivationKeyCommitment}, exclusion manifest has ${exclusionJson.derivationKeyCommitment}`
    );
  }
  if (
    record.replacementHoldoutCommitment.derivationKeyCommitment &&
    record.replacementHoldoutCommitment.derivationKeyCommitment !== 'UNRESOLVED_PRE_EXECUTION_COMMITMENT' &&
    record.replacementHoldoutCommitment.derivationKeyCommitment !== holdoutJson.derivationKeyCommitment
  ) {
    throw new Error('Replacement holdout commitment derivationKeyCommitment mismatch between record and artifact');
  }
  if (
    record.challengePoolAndExclusionCommitment.derivationKeyCommitment &&
    record.challengePoolAndExclusionCommitment.derivationKeyCommitment !== 'UNRESOLVED_PRE_EXECUTION_COMMITMENT' &&
    record.challengePoolAndExclusionCommitment.derivationKeyCommitment !== exclusionJson.derivationKeyCommitment
  ) {
    throw new Error('Challenge pool commitment derivationKeyCommitment mismatch between record and artifact');
  }

  // Member-level replacement holdout disjointness & aggregate binding (Gap B2)
  const holdoutCohort = exclusionJson.prohibitedCohorts?.replacementProspectiveHoldout;
  if (!holdoutCohort) {
    throw new Error('Exclusion manifest missing replacementProspectiveHoldout in prohibitedCohorts');
  }
  if (holdoutCohort.candidateCount !== holdoutJson.candidateCount) {
    throw new Error(
      `Exclusion manifest replacement holdout candidateCount (${holdoutCohort.candidateCount}) does not match holdout commitment candidateCount (${holdoutJson.candidateCount})`
    );
  }
  if (holdoutCohort.opaqueMemberHashes.length !== holdoutJson.candidateCount) {
    throw new Error(
      `Exclusion manifest replacement holdout opaqueMemberHashes length (${holdoutCohort.opaqueMemberHashes.length}) does not match candidateCount (${holdoutJson.candidateCount})`
    );
  }
  const recomputedMemberSetHash = computeOpaqueMemberReferenceSetHash(holdoutCohort.opaqueMemberHashes);
  if (recomputedMemberSetHash !== holdoutJson.opaqueMemberReferenceSetHash) {
    throw new Error(
      `Replacement holdout opaqueMemberReferenceSetHash mismatch: holdout committed ${holdoutJson.opaqueMemberReferenceSetHash}, exclusion manifest recomputes to ${recomputedMemberSetHash}`
    );
  }

  // 8. Human Resource Confirmation
  const hrRes = verifyCommittedFileSha256(
    record.humanResourceConfirmationCommitment.path,
    record.humanResourceConfirmationCommitment.sha256,
    workspaceRoot
  );
  let hrJson;
  try {
    hrJson = JSON.parse(hrRes.rawBytes.toString('utf8'));
  } catch (err) {
    throw new Error(`Failed to parse human resource confirmation JSON: ${err.message}`);
  }

  loadAndValidateSchema(
    hrJson,
    'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/human-resource-confirmation.schema.v1.json',
    workspaceRoot,
    'humanResourceConfirmation'
  );

  validateHumanResourceConfirmation(hrJson);
  if (hrJson.schemaVersion !== 'human-resource-confirmation.v1') {
    throw new Error(`Human resource confirmation schemaVersion mismatch: got ${hrJson.schemaVersion}`);
  }
  if (hrJson.protocolId !== 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1') {
    throw new Error(`Human resource confirmation protocolId mismatch: got ${hrJson.protocolId}`);
  }
  if (hrJson.requiredDistinctCount !== 8) {
    throw new Error(`Human resource confirmation requiredDistinctCount must be 8, got ${hrJson.requiredDistinctCount}`);
  }

  // 9. Runtime Dependency Declaration
  const rtRes = verifyCommittedFileSha256(
    record.runtimeDependencyDeclarationCommitment.path,
    record.runtimeDependencyDeclarationCommitment.sha256,
    workspaceRoot
  );
  let rtJson;
  try {
    rtJson = JSON.parse(rtRes.rawBytes.toString('utf8'));
  } catch (err) {
    throw new Error(`Failed to parse runtime dependency declaration JSON: ${err.message}`);
  }

  loadAndValidateSchema(
    rtJson,
    'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/runtime-dependency-declaration.schema.v1.json',
    workspaceRoot,
    'runtimeDependencyDeclaration'
  );

  if (rtJson.schemaVersion !== 'runtime-dependency-declaration.v1') {
    throw new Error(`Runtime dependency declaration schemaVersion mismatch: got ${rtJson.schemaVersion}`);
  }
  if (rtJson.protocolId !== 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1') {
    throw new Error(`Runtime dependency declaration protocolId mismatch: got ${rtJson.protocolId}`);
  }
  if (rtJson.allSemanticDependenciesDeclared !== true) {
    throw new Error('Runtime dependency declaration must declare allSemanticDependenciesDeclared === true');
  }

  if (rtJson.deterministicLintFindingsDisposition !== record.runtimeDependencyDeclarationCommitment.deterministicLintFindings) {
    throw new Error(
      `deterministicLintFindings mismatch between freeze record (${record.runtimeDependencyDeclarationCommitment.deterministicLintFindings}) and declaration (${rtJson.deterministicLintFindingsDisposition})`
    );
  }

  if (!Array.isArray(rtJson.dependencies) || rtJson.dependencies.length === 0) {
    throw new Error('Runtime dependency declaration must contain a non-empty dependencies array');
  }

  for (const dep of rtJson.dependencies) {
    if (dep.semanticPayloadImpact === true) {
      if (!dep.sha256 && dep.valueCommitment === undefined) {
        throw new Error(
          `Semantic dependency ${dep.reference} must have sha256 or valueCommitment declared`
        );
      }
      if (
        (dep.dependencyType === 'source_code_file' ||
          dep.dependencyType === 'configuration_file' ||
          dep.dependencyType === 'generated_artifact') &&
        dep.sha256 &&
        !dep.reference.startsWith('http://') &&
        !dep.reference.startsWith('https://')
      ) {
        verifyCommittedFileSha256(dep.reference, dep.sha256, workspaceRoot);
      }
    }
  }

  // 10. Analysis Plan
  const analysisRes = verifyCommittedFileSha256(
    record.analysisPlanCommitment.path,
    record.analysisPlanCommitment.sha256,
    workspaceRoot
  );
  let analysisJson;
  try {
    analysisJson = JSON.parse(analysisRes.rawBytes.toString('utf8'));
  } catch (err) {
    throw new Error(`Failed to parse analysis plan JSON: ${err.message}`);
  }

  loadAndValidateSchema(
    analysisJson,
    'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/analysis-plan.schema.v1.json',
    workspaceRoot,
    'analysisPlan'
  );

  if (analysisJson.schemaVersion !== 'analysis-plan.v1') {
    throw new Error(`Analysis plan schemaVersion mismatch: got ${analysisJson.schemaVersion}`);
  }
  if (analysisJson.protocolId !== 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1') {
    throw new Error(`Analysis plan protocolId mismatch: got ${analysisJson.protocolId}`);
  }

  const naturalRules = analysisJson.naturalArmRules;
  if (!naturalRules) throw new Error('Analysis plan missing naturalArmRules');
  if (naturalRules.minimumCleanDenominator < 20 || naturalRules.minimumMinorDenominator < 20) {
    throw new Error('Analysis plan minimum denominators must be >= 20');
  }
  if (naturalRules.maximumValidNaturalPackets !== 100) {
    throw new Error('Analysis plan maximumValidNaturalPackets must be 100');
  }
  if (naturalRules.minorRateGateFormula !== 'minorLowRiskCount <= floor(0.10 * humanMinorCount)') {
    throw new Error(
      `Analysis plan minorRateGateFormula mismatch: got ${naturalRules.minorRateGateFormula}`
    );
  }
  if (naturalRules.cleanRateGateFormula !== 'cleanHighRiskCount <= floor(0.10 * humanCleanCount)') {
    throw new Error(
      `Analysis plan cleanRateGateFormula mismatch: got ${naturalRules.cleanRateGateFormula}`
    );
  }
  if (naturalRules.fixedCountRuleRejected !== true) {
    throw new Error('Analysis plan must reject fixed count rules (fixedCountRuleRejected must be true)');
  }

  // 11. Operator Log Schema
  const opLogRes = verifyCommittedFileSha256(
    record.operatorLogSchemaCommitment.path,
    record.operatorLogSchemaCommitment.sha256,
    workspaceRoot
  );
  let opLogJson;
  try {
    opLogJson = JSON.parse(opLogRes.rawBytes.toString('utf8'));
  } catch (err) {
    throw new Error(`Failed to parse operator log schema JSON: ${err.message}`);
  }

  if (opLogJson.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    throw new Error('Operator log schema must declare draft 2020-12 $schema');
  }
  if (opLogJson.type !== 'object') {
    throw new Error('Operator log schema type must be object');
  }

  const retryProperty = opLogJson.properties?.entries?.items?.properties?.retryCount;
  if (!retryProperty || (retryProperty.const !== 0 && retryProperty.maximum !== 0)) {
    throw new Error('Operator log schema must enforce retryCount == 0 (const: 0 or maximum: 0)');
  }

  // 12. Freeze Validation Toolchain Manifest Exactness (Gap 8)
  const toolchainRes = verifyCommittedFileSha256(
    record.freezeValidationToolchainCommitment.path,
    record.freezeValidationToolchainCommitment.sha256,
    workspaceRoot
  );
  let toolchainJson;
  try {
    toolchainJson = JSON.parse(toolchainRes.rawBytes.toString('utf8'));
  } catch (err) {
    throw new Error(`Failed to parse freeze validation toolchain manifest JSON: ${err.message}`);
  }

  if (toolchainJson.schemaVersion !== 'freeze-preparation-manifest.v1') {
    throw new Error(`Toolchain manifest schemaVersion mismatch: expected freeze-preparation-manifest.v1, got ${toolchainJson.schemaVersion}`);
  }
  if (toolchainJson.manifestId !== 'freeze-preparation-manifest.r2.1') {
    throw new Error(`Toolchain manifest manifestId mismatch: expected freeze-preparation-manifest.r2.1, got ${toolchainJson.manifestId}`);
  }
  if (toolchainJson.protocolId !== 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1') {
    throw new Error(`Toolchain manifest protocolId mismatch: expected source-boundary-risk-verifier.v1.4-prospective-validation.r2.1, got ${toolchainJson.protocolId}`);
  }
  if (!toolchainJson.toolchainFiles || typeof toolchainJson.toolchainFiles !== 'object') {
    throw new Error('Freeze validation toolchain manifest must contain toolchainFiles mapping');
  }
  if ('governedFiles' in toolchainJson) {
    throw new Error('Freeze validation toolchain manifest contains legacy or redundant governedFiles mapping; only toolchainFiles is permitted');
  }

  const manifestPaths = Object.keys(toolchainJson.toolchainFiles);
  for (const expectedPath of R2_1_EXPECTED_TOOLCHAIN_FILES) {
    if (toolchainJson.toolchainFiles[expectedPath] === undefined) {
      throw new Error(`Freeze validation toolchain manifest missing expected governed file: ${expectedPath}`);
    }
  }
  for (const manifestPath of manifestPaths) {
    if (!R2_1_EXPECTED_TOOLCHAIN_FILES.includes(manifestPath)) {
      throw new Error(`Freeze validation toolchain manifest contains unexpected unapproved file: ${manifestPath}`);
    }
  }

  for (const [toolPath, expectedSha] of Object.entries(toolchainJson.toolchainFiles)) {
    verifyCommittedFileSha256(toolPath, expectedSha, workspaceRoot);
  }

  // 13. External Governance Anchor Check via Git Checkpoint (Gap A)
  verifyFreezePreparationCheckpointCommit({
    commitSha: record.freezePreparationCheckpointCommit,
    workspaceRoot,
    toolchainManifest: toolchainJson,
    expectedToolchainSha: record.freezeValidationToolchainCommitment.sha256,
    toolchainManifestRelPath: record.freezeValidationToolchainCommitment.path,
  });

  return {
    status: 'EXECUTION_READY',
    isExecutionReady: true,
    message: 'Freeze package is complete, all commitments bound, and all referenced artifacts verified cryptographically, structurally via schemas, and semantically.',
  };
}
