import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  computeChallengeExecutionOrderHash,
  computeDerivationKeyCommitment,
  computeOpaqueMemberReferenceSetHash,
  computeSha256,
  deriveOpaqueMemberHash,
  deriveOpaqueMemberHmac,
  evaluateChallengeArmQualification,
  evaluateNaturalArmRateGate,
  extractCandidateIdsFromSource,
  FORBIDDEN_HOLDOUT_CONTENT_KEYS,
  R2_1_DERIVATION_SCHEME,
  R2_1_DERIVATION_VERSION,
  R2_1_EXPECTED_TOOLCHAIN_FILES,
  R2_1_FAILURE_CLASSES,
  R2_1_HUMAN_ROLES,
  R2_1_MANIFEST_PATH,
  R2_1_MANIFEST_SHA256,
  R2_1_PROTOCOL_PATH,
  R2_1_PROTOCOL_SHA256,
  R2_1_SOURCE_ARTIFACT_HASHES,
  resolveSafeWorkspacePath,
  validateChallengeSourceExclusion,
  validateHumanResourceConfirmation,
  validateJsonSchema,
  validateProspectiveFreezeRecord,
  validateReplacementHoldoutCommitment,
  verifyCommittedFileSha256,
  verifyFreezePreparationCheckpointCommit,
} from './validateVerifierV14ProspectiveFreeze.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '../..');

const templatePath = path.join(
  workspaceRoot,
  'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/execution-freeze-record.template.v1.json'
);
const templateJson = JSON.parse(fs.readFileSync(templatePath, 'utf8'));

const scratchDir = path.join(
  workspaceRoot,
  'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/test-scratch-fixture'
);

function cleanScratchDir() {
  if (fs.existsSync(scratchDir)) {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

function createRealSyntheticFixtureBundle() {
  cleanScratchDir();
  fs.mkdirSync(scratchDir, { recursive: true });

  const relScratch = path.relative(workspaceRoot, scratchDir);

  // 1. Transformation Spec
  const transSpecPath = path.join(scratchDir, 'challenge-transformation-spec.md');
  const transSpecContent = '# Frozen Challenge Transformation Specification\nDeterministic test spec.\n';
  fs.writeFileSync(transSpecPath, transSpecContent, 'utf8');
  const transSpecSha = 'sha256:' + computeSha256(Buffer.from(transSpecContent));
  const relTransSpec = path.join(relScratch, 'challenge-transformation-spec.md');

  // Common HMAC Derivation Domain
  const syntheticKey = 'test-secret-custodian-hmac-key-2026';
  const keyCommitment = computeDerivationKeyCommitment(syntheticKey);

  // 2. Challenge Attempt Manifest (18 attempts, 6 per class) with distinct sources
  const sourceHashes = Array.from(
    { length: 18 },
    (_, i) => deriveOpaqueMemberHmac(syntheticKey, `cand-challenge-source-${String(i + 1).padStart(2, '0')}`)
  );
  const classes = [
    ...Array(6).fill(R2_1_FAILURE_CLASSES[0]),
    ...Array(6).fill(R2_1_FAILURE_CLASSES[1]),
    ...Array(6).fill(R2_1_FAILURE_CLASSES[2]),
  ];
  const attempts = classes.map((fc, i) => ({
    attemptId: `challenge-attempt-${String(i + 1).padStart(2, '0')}`,
    failureClass: fc,
    attemptOrderIndex: i + 1,
    sourceCandidateMemberReferenceHash: sourceHashes[i],
    sourcePacketReferenceHash: 'sha256:' + String(i + 1).padStart(2, '0') + 'a'.repeat(62),
    constructionArtifactHash: 'sha256:' + String(i + 1).padStart(2, '0').repeat(32),
    transformationSpecHash: transSpecSha,
    adjudicatorAJudgment: 'SEVERE',
    adjudicatorBJudgment: 'SEVERE',
    qualificationState: 'QUALIFIES_UNANIMOUS_SEVERE',
  }));

  const attemptManifestObj = {
    schemaVersion: 'challenge-attempt-manifest.v1',
    manifestId: 'challenge-attempt-manifest.test-fixture',
    protocolId: 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1',
    totalAttempts: 18,
    attemptsPerClass: 6,
    failureClasses: [...R2_1_FAILURE_CLASSES],
    attempts,
  };
  const attemptManifestPath = path.join(scratchDir, 'challenge-attempt-manifest.json');
  const attemptManifestContent = JSON.stringify(attemptManifestObj, null, 2);
  fs.writeFileSync(attemptManifestPath, attemptManifestContent, 'utf8');
  const attemptManifestSha = 'sha256:' + computeSha256(Buffer.from(attemptManifestContent));
  const relAttemptManifest = path.join(relScratch, 'challenge-attempt-manifest.json');

  // 3. Challenge Qualification Manifest
  const evalResult = evaluateChallengeArmQualification(attempts);
  const qualManifestObj = {
    schemaVersion: 'challenge-qualification-manifest.v1',
    qualificationManifestId: 'challenge-qualification-manifest.test-fixture',
    protocolId: 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1',
    attemptManifestPath: relAttemptManifest,
    attemptManifestSha256: attemptManifestSha,
    qualificationStatus: 'READY',
    thirdHumanRescue: false,
    totalQualifying: 12,
    qualifyingPerClass: evalResult.qualifyingPerClass,
    qualifyingCases: evalResult.qualifyingCases,
    nonqualifyingProvenance: evalResult.nonqualifyingProvenance,
  };
  const qualManifestPath = path.join(scratchDir, 'challenge-qualification-manifest.json');
  const qualManifestContent = JSON.stringify(qualManifestObj, null, 2);
  fs.writeFileSync(qualManifestPath, qualManifestContent, 'utf8');
  const qualManifestSha = 'sha256:' + computeSha256(Buffer.from(qualManifestContent));
  const relQualManifest = path.join(relScratch, 'challenge-qualification-manifest.json');

  // 4. Replacement Holdout Commitment (Gap B2: member-level hashes and aggregate set hash)
  const holdoutMemberHashes = Array.from(
    { length: 100 },
    (_, i) => deriveOpaqueMemberHmac(syntheticKey, `cand-replacement-holdout-${String(i + 1).padStart(4, '0')}`)
  ).sort();
  const holdoutMemberSetHash = computeOpaqueMemberReferenceSetHash(holdoutMemberHashes);
  const holdoutObj = {
    schemaVersion: 'replacement-holdout-commitment.v1',
    commitmentId: 'replacement-holdout-commitment.test-fixture',
    protocolId: 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1',
    opaqueMembershipHash: 'sha256:' + 'b'.repeat(64),
    opaqueMemberReferenceSetHash: holdoutMemberSetHash,
    deterministicOrderHash: 'sha256:' + 'c'.repeat(64),
    candidateCount: 100,
    derivationScheme: R2_1_DERIVATION_SCHEME,
    derivationVersion: R2_1_DERIVATION_VERSION,
    derivationKeyCommitment: keyCommitment,
    sealingMethod: 'SHA256_CANONICAL_MERKLE_MOCK',
    sealingVersion: '1.0',
    custodianId: 'personnel-custodian',
    sealedAt: '2026-09-20T18:00:00Z',
    integrityStatus: 'SEALED_AND_ISOLATED',
  };
  const holdoutPath = path.join(scratchDir, 'replacement-holdout-commitment.json');
  const holdoutContent = JSON.stringify(holdoutObj, null, 2);
  fs.writeFileSync(holdoutPath, holdoutContent, 'utf8');
  const holdoutSha = 'sha256:' + computeSha256(Buffer.from(holdoutContent));
  const relHoldout = path.join(relScratch, 'replacement-holdout-commitment.json');

  // 5. Authoritative Cohort Sources (Prohibited-Cohort Authenticity)
  const devCandidates = ['cand-dev-01', 'cand-dev-02', 'cand-dev-03'];
  const devCandidatesPath = path.join(scratchDir, 'dev-candidates.json');
  const devCandidatesContent = JSON.stringify(devCandidates, null, 2);
  fs.writeFileSync(devCandidatesPath, devCandidatesContent, 'utf8');
  const devCandidatesSha = 'sha256:' + computeSha256(Buffer.from(devCandidatesContent));
  const relDevCandidates = path.join(relScratch, 'dev-candidates.json');
  const devHashes = devCandidates.map((c) => deriveOpaqueMemberHmac(syntheticKey, c)).sort();

  const retroCandidates = ['cand-retro-01', 'cand-retro-02', 'cand-retro-03'];
  const retroCandidatesPath = path.join(scratchDir, 'retro-candidates.json');
  const retroCandidatesContent = JSON.stringify(retroCandidates, null, 2);
  fs.writeFileSync(retroCandidatesPath, retroCandidatesContent, 'utf8');
  const retroCandidatesSha = 'sha256:' + computeSha256(Buffer.from(retroCandidatesContent));
  const relRetroCandidates = path.join(relScratch, 'retro-candidates.json');
  const retroHashes = retroCandidates.map((c) => deriveOpaqueMemberHmac(syntheticKey, c)).sort();

  const prodCandidates = ['cand-prod-01', 'cand-prod-02', 'cand-prod-03'];
  const prodCandidatesPath = path.join(scratchDir, 'prod-candidates.json');
  const prodCandidatesContent = JSON.stringify(prodCandidates, null, 2);
  fs.writeFileSync(prodCandidatesPath, prodCandidatesContent, 'utf8');
  const prodCandidatesSha = 'sha256:' + computeSha256(Buffer.from(prodCandidatesContent));
  const relProdCandidates = path.join(relScratch, 'prod-candidates.json');
  const prodHashes = prodCandidates.map((c) => deriveOpaqueMemberHmac(syntheticKey, c)).sort();

  // 6. Challenge Pool and Exclusion Manifest (Gap B, Gap B2)
  const poolObj = {
    schemaVersion: 'challenge-source-exclusion.v1',
    manifestId: 'challenge-source-exclusion.test-fixture',
    protocolId: 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1',
    challengeSourcePoolId: 'test-severe-challenge-pool-01',
    derivationScheme: R2_1_DERIVATION_SCHEME,
    derivationVersion: R2_1_DERIVATION_VERSION,
    derivationKeyCommitment: keyCommitment,
    challengeSourceMemberHashes: sourceHashes,
    prohibitedCohorts: {
      developmentCohort: {
        cohortName: 'verifier-v1.4-development',
        sourceMembershipCommitment: {
          path: relDevCandidates,
          sha256: devCandidatesSha,
          candidateCount: 3,
          derivationScheme: R2_1_DERIVATION_SCHEME,
          derivationVersion: R2_1_DERIVATION_VERSION,
          derivationKeyCommitment: keyCommitment,
        },
        derivationScheme: R2_1_DERIVATION_SCHEME,
        derivationVersion: R2_1_DERIVATION_VERSION,
        derivationKeyCommitment: keyCommitment,
        opaqueMemberHashes: devHashes,
      },
      retrospectiveV14Cohort: {
        cohortName: 'verifier-v1.4-retrospective-continuation',
        sourceMembershipCommitment: {
          path: relRetroCandidates,
          sha256: retroCandidatesSha,
          candidateCount: 3,
          derivationScheme: R2_1_DERIVATION_SCHEME,
          derivationVersion: R2_1_DERIVATION_VERSION,
          derivationKeyCommitment: keyCommitment,
        },
        derivationScheme: R2_1_DERIVATION_SCHEME,
        derivationVersion: R2_1_DERIVATION_VERSION,
        derivationKeyCommitment: keyCommitment,
        opaqueMemberHashes: retroHashes,
      },
      currentProductionCohort: {
        cohortName: 'scale-tranche-1-production',
        sourceMembershipCommitment: {
          path: relProdCandidates,
          sha256: prodCandidatesSha,
          candidateCount: 3,
          derivationScheme: R2_1_DERIVATION_SCHEME,
          derivationVersion: R2_1_DERIVATION_VERSION,
          derivationKeyCommitment: keyCommitment,
        },
        derivationScheme: R2_1_DERIVATION_SCHEME,
        derivationVersion: R2_1_DERIVATION_VERSION,
        derivationKeyCommitment: keyCommitment,
        opaqueMemberHashes: prodHashes,
      },
      replacementProspectiveHoldout: {
        cohortName: 'replacement-prospective-holdout',
        candidateCount: 100,
        derivationScheme: R2_1_DERIVATION_SCHEME,
        derivationVersion: R2_1_DERIVATION_VERSION,
        derivationKeyCommitment: keyCommitment,
        opaqueMemberHashes: holdoutMemberHashes,
      },
    },
    custodianDerivationAttestation: {
      custodianId: 'personnel-custodian',
      attestationStatement: 'CUSTODIAN_ATTESTS_UNIFORM_HMAC_DERIVATION_ACROSS_ALL_COHORTS',
      attestedAt: '2026-09-20T18:00:00Z',
    },
    exclusionVerificationStatus: 'DISJOINT_EXCLUSION_PROVEN',
  };
  const poolPath = path.join(scratchDir, 'challenge-source-exclusion.json');
  const poolContent = JSON.stringify(poolObj, null, 2);
  fs.writeFileSync(poolPath, poolContent, 'utf8');
  const poolSha = 'sha256:' + computeSha256(Buffer.from(poolContent));
  const relPool = path.join(relScratch, 'challenge-source-exclusion.json');

  // 6. Human Resource Confirmation
  const hrObj = {
    schemaVersion: 'human-resource-confirmation.v1',
    confirmationId: 'human-resource-confirmation.test-fixture',
    protocolId: 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1',
    requiredDistinctCount: 8,
    allRolesDistinct: true,
    roleAssignments: {
      independent_custodian: 'personnel-custodian',
      challenge_construction_author: 'personnel-author',
      challenge_adjudicator_A: 'personnel-adj-a',
      challenge_adjudicator_B: 'personnel-adj-b',
      natural_primary_adjudicator: 'personnel-primary',
      natural_QA_adjudicator: 'personnel-qa',
      natural_reconciliation_adjudicator: 'personnel-reconciler',
      verifier_operator: 'personnel-operator',
    },
  };
  const hrPath = path.join(scratchDir, 'human-resource-confirmation.json');
  const hrContent = JSON.stringify(hrObj, null, 2);
  fs.writeFileSync(hrPath, hrContent, 'utf8');
  const hrSha = 'sha256:' + computeSha256(Buffer.from(hrContent));
  const relHr = path.join(relScratch, 'human-resource-confirmation.json');

  // 7. Runtime Dependency Declaration
  const builderSha = 'sha256:de201c6695d8198aac7059ceab1e1630cca9db9448b68c62a93a46137e98287c';
  const rtObj = {
    schemaVersion: 'runtime-dependency-declaration.v1',
    declarationId: 'runtime-dependency-declaration.test-fixture',
    protocolId: 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1',
    deterministicLintFindingsDisposition: 'UNIVERSALLY_ABSENT',
    allSemanticDependenciesDeclared: true,
    dependencies: [
      {
        reference: 'catalogue-pipeline/scripts/scaleTranche1Plan.mjs',
        dependencyType: 'source_code_file',
        sha256: builderSha,
        semanticPayloadImpact: true,
        required: true,
        disposition: 'FROZEN_BUILDER',
      },
    ],
  };
  const rtPath = path.join(scratchDir, 'runtime-dependency-declaration.json');
  const rtContent = JSON.stringify(rtObj, null, 2);
  fs.writeFileSync(rtPath, rtContent, 'utf8');
  const rtSha = 'sha256:' + computeSha256(Buffer.from(rtContent));
  const relRt = path.join(relScratch, 'runtime-dependency-declaration.json');

  // 8. Analysis Plan
  const planObj = {
    schemaVersion: 'analysis-plan.v1',
    planId: 'analysis-plan.test-fixture',
    protocolId: 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1',
    naturalArmRules: {
      minimumCleanDenominator: 20,
      minimumMinorDenominator: 20,
      maximumValidNaturalPackets: 100,
      minorRateGateFormula: 'minorLowRiskCount <= floor(0.10 * humanMinorCount)',
      cleanRateGateFormula: 'cleanHighRiskCount <= floor(0.10 * humanCleanCount)',
      fixedCountRuleRejected: true,
    },
    challengeArmRules: {
      qualifyingCaseCount: 12,
      permittedSevereEscapes: 0,
      immediateTerminationOnEscape: true,
    },
    outcomeRules: {
      passDefinition: 'ZERO_CHALLENGE_ESCAPES_AND_ZERO_NATURAL_SEVERE_ESCAPES_AND_BOTH_TERMINAL_RATES_PASS_AND_ZERO_TECHNICAL_ABORT',
      failDefinition: 'ANY_SEVERE_ESCAPE_OR_TERMINAL_NATURAL_ERROR_RATE_EXCEEDS_10_PERCENT',
      inconclusiveDefinition: 'INSUFFICIENT_QUALIFYING_CHALLENGES_OR_NATURAL_DENOMINATOR_BELOW_20_AT_PACKET_100',
      technicalAbortDefinition: 'ANY_INTEGRITY_VIOLATION_INVALIDATES_ENTIRE_RUN',
    },
  };
  const planPath = path.join(scratchDir, 'analysis-plan.json');
  const planContent = JSON.stringify(planObj, null, 2);
  fs.writeFileSync(planPath, planContent, 'utf8');
  const planSha = 'sha256:' + computeSha256(Buffer.from(planContent));
  const relPlan = path.join(relScratch, 'analysis-plan.json');

  // 9. Operator Log Schema
  const opLogSchemaSource = fs.readFileSync(
    path.join(workspaceRoot, 'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/operator-log.schema.v1.json'),
    'utf8'
  );
  const opLogSchemaPath = path.join(scratchDir, 'operator-log.schema.v1.json');
  fs.writeFileSync(opLogSchemaPath, opLogSchemaSource, 'utf8');
  const opLogSchemaSha = 'sha256:' + computeSha256(Buffer.from(opLogSchemaSource));
  const relOpLogSchema = path.join(relScratch, 'operator-log.schema.v1.json');

  // 10. Freeze Validation Toolchain Manifest (all 12 governed files)
  const toolchainFiles = {};
  for (const f of R2_1_EXPECTED_TOOLCHAIN_FILES) {
    const full = path.join(workspaceRoot, f);
    toolchainFiles[f] = 'sha256:' + computeSha256(fs.readFileSync(full));
  }
  const toolchainManifestObj = {
    schemaVersion: 'freeze-preparation-manifest.v1',
    manifestId: 'freeze-preparation-manifest.r2.1',
    protocolId: 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1',
    description: 'Deterministic toolchain provenance manifest for the r2.1 pre-execution freeze preparation machinery.',
    toolchainFiles,
  };
  const toolchainManifestPath = path.join(scratchDir, 'freeze-preparation-manifest.v1.json');
  const toolchainManifestContent = JSON.stringify(toolchainManifestObj, null, 2);
  fs.writeFileSync(toolchainManifestPath, toolchainManifestContent, 'utf8');
  const toolchainManifestSha = 'sha256:' + computeSha256(Buffer.from(toolchainManifestContent));
  const relToolchainManifest = path.join(relScratch, 'freeze-preparation-manifest.v1.json');

  // Build EXECUTION_READY freeze record
  const freezeRecord = {
    schemaVersion: 'execution-freeze-record.v1',
    freezeId: 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1-freeze-synthetic-01',
    protocolId: 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1',
    status: 'EXECUTION_READY',
    governanceAuthority: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/V1_4_FINAL_SYNTHESIS_AND_GOVERNANCE.md',
    protocolCommitment: {
      path: R2_1_PROTOCOL_PATH,
      sha256: 'sha256:' + R2_1_PROTOCOL_SHA256,
    },
    manifestCommitment: {
      path: R2_1_MANIFEST_PATH,
      sha256: 'sha256:' + R2_1_MANIFEST_SHA256,
    },
    replacementHoldoutCommitment: {
      path: relHoldout,
      sha256: holdoutSha,
      opaqueMembershipHash: holdoutObj.opaqueMembershipHash,
      opaqueMemberReferenceSetHash: holdoutObj.opaqueMemberReferenceSetHash,
      deterministicOrderHash: holdoutObj.deterministicOrderHash,
      candidateCount: 100,
      sealingMethod: holdoutObj.sealingMethod,
      status: 'SEALED_AND_ISOLATED',
    },
    qaSeedCommitment: {
      qaSeedHash: 'sha256:' + 'd'.repeat(64),
      status: 'COMMITTED_BY_INDEPENDENT_CUSTODIAN',
    },
    challengePoolAndExclusionCommitment: {
      path: relPool,
      sha256: poolSha,
      status: 'COMMITTED_AND_EXCLUSION_PROVED',
    },
    challengeAttemptManifestCommitment: {
      path: relAttemptManifest,
      sha256: attemptManifestSha,
      totalAttempts: 18,
      status: 'ALL_18_ATTEMPTS_LABELED',
    },
    challengeTransformationSpecCommitment: {
      path: relTransSpec,
      sha256: transSpecSha,
      status: 'FROZEN_BEFORE_CONSTRUCTION',
    },
    challengeQualificationManifestCommitment: {
      path: relQualManifest,
      sha256: qualManifestSha,
      totalQualifying: 12,
      qualificationRule: 'BOTH_INITIAL_HUMANS_SEVERE',
      thirdHumanRescue: false,
      status: 'READY',
    },
    runtimeDependencyDeclarationCommitment: {
      path: relRt,
      sha256: rtSha,
      deterministicLintFindings: 'UNIVERSALLY_ABSENT',
      status: 'DECLARED_AND_BOUND',
    },
    analysisPlanCommitment: {
      path: relPlan,
      sha256: planSha,
      rateRuleFormula: 'errorCount <= floor(0.10 * realizedHumanLabelCount)',
      status: 'PREREGISTERED',
    },
    operatorLogSchemaCommitment: {
      path: relOpLogSchema,
      sha256: opLogSchemaSha,
      retryRule: 'retryCount == 0',
      status: 'BOUND',
    },
    fixedExecutionOrderCommitment: {
      interArmSequencing: 'qualifying_challenges_first_then_natural_stream',
      challengeOrderHash: computeChallengeExecutionOrderHash(evalResult.qualifyingCases),
      naturalOrderHash: holdoutObj.deterministicOrderHash,
      status: 'ORDER_LOCKED',
    },
    humanResourceConfirmationCommitment: {
      path: relHr,
      sha256: hrSha,
      requiredDistinctPeople: 8,
      status: 'CONFIRMED',
    },
    frozenModelConfigurationCommitment: {
      provider: 'google-gemini-developer-api',
      modelId: 'gemini-3.8-flash',
      thinkingLevel: 'low',
      temperature: 0.0,
      maxOutputTokens: 6144,
      timeoutMs: 30000,
      automaticRetries: 0,
      fallbackProhibited: true,
    },
    inputContractCommitments: {
      verifierInputBuilder: {
        path: 'catalogue-pipeline/scripts/scaleTranche1Plan.mjs',
        sha256: 'sha256:de201c6695d8198aac7059ceab1e1630cca9db9448b68c62a93a46137e98287c',
      },
      surfaceAndLeakageContract: {
        path: 'catalogue-pipeline/scripts/runVerifierV13RetrospectiveReplay.mjs',
        sha256: 'sha256:3976a45b6e0655599c97bb560d6463ff78715a68b676225d117113a5f7382690',
      },
      blindPacketSchema: {
        path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/blind-human-review-packet.schema.v1.json',
        sha256: 'sha256:6bae3f04c4fc8d80d03e86adc389fb68a83b79098209b60fc498c59e0a4af257',
      },
      requiredSurfaces: [
        'facts',
        'acceptedSemanticClassification',
        'semanticBoundaryFlags',
        'allowedSourceMaterial',
        'spoilerBoundaryRules',
        'copyConstraints',
        'visibleEditorialCopy',
      ],
    },
    freezeValidationToolchainCommitment: {
      path: relToolchainManifest,
      sha256: toolchainManifestSha,
      status: 'VERIFIED_DETERMINISTIC_PROVENANCE',
    },
    freezePreparationCheckpointCommit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    freezeMetadata: {
      createdAt: '2026-09-20T18:00:00Z',
      preparedByRole: 'INDEPENDENT_PREPARATION_INFRASTRUCTURE',
      custodianSignoffStatus: 'SIGNED_EXECUTION_FREEZE_AWAITING_SEPARATE_AUTHORIZATION',
    },
  };

  return {
    scratchDir,
    relScratch,
    freezeRecord,
    paths: {
      transSpecPath,
      poolPath,
      attemptManifestPath,
      qualManifestPath,
      holdoutPath,
      hrPath,
      rtPath,
      planPath,
      opLogSchemaPath,
      toolchainManifestPath,
    },
    objs: {
      attemptManifestObj,
      qualManifestObj,
      holdoutObj,
      poolObj,
      hrObj,
      rtObj,
      planObj,
      toolchainManifestObj,
    },
  };
}

function createSyntheticGitRepoFixture() {
  const tempRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-git-repo-'));

  // Helper to copy files preserving relative path
  function copyFile(relPath) {
    const src = path.join(workspaceRoot, relPath);
    const dst = path.join(tempRepoDir, relPath);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }

  // Copy Protocol & Manifest
  copyFile(R2_1_PROTOCOL_PATH);
  copyFile(R2_1_MANIFEST_PATH);

  // Copy 8 Source Artifacts
  for (const srcPath of Object.keys(R2_1_SOURCE_ARTIFACT_HASHES)) {
    copyFile(srcPath);
  }

  // Copy 12 Governed Toolchain Files
  for (const toolFile of R2_1_EXPECTED_TOOLCHAIN_FILES) {
    copyFile(toolFile);
  }

  // Compute actual toolchain file hashes in tempRepoDir
  const toolchainFiles = {};
  for (const f of R2_1_EXPECTED_TOOLCHAIN_FILES) {
    const full = path.join(tempRepoDir, f);
    toolchainFiles[f] = 'sha256:' + computeSha256(fs.readFileSync(full));
  }
  const toolchainManifestObj = {
    schemaVersion: 'freeze-preparation-manifest.v1',
    manifestId: 'freeze-preparation-manifest.r2.1',
    protocolId: 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1',
    description: 'Deterministic toolchain provenance manifest for the r2.1 pre-execution freeze preparation machinery.',
    toolchainFiles,
  };
  const toolchainManifestRel = 'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/freeze-preparation-manifest.v1.json';
  const toolchainManifestFull = path.join(tempRepoDir, toolchainManifestRel);
  fs.mkdirSync(path.dirname(toolchainManifestFull), { recursive: true });
  fs.writeFileSync(toolchainManifestFull, JSON.stringify(toolchainManifestObj, null, 2), 'utf8');
  const toolchainManifestSha = 'sha256:' + computeSha256(fs.readFileSync(toolchainManifestFull));

  // Create the fixture bundle within tempRepoDir/scratch
  const relScratch = 'scratch-fixture';
  const scratchPath = path.join(tempRepoDir, relScratch);
  fs.mkdirSync(scratchPath, { recursive: true });

  // 1. Transformation Spec
  const transSpecContent = '# Frozen Challenge Transformation Specification\nDeterministic test spec.\n';
  const transSpecPath = path.join(scratchPath, 'challenge-transformation-spec.md');
  fs.writeFileSync(transSpecPath, transSpecContent, 'utf8');
  const transSpecSha = 'sha256:' + computeSha256(Buffer.from(transSpecContent));
  const relTransSpec = path.join(relScratch, 'challenge-transformation-spec.md');

  // 2. Attempts & Sources with Unified HMAC Derivation
  const syntheticKey = 'synthetic-secret-key-test-fixture-git-repo-42';
  const keyCommitment = computeDerivationKeyCommitment(syntheticKey);

  const sourceHashes = Array.from(
    { length: 18 },
    (_, i) => deriveOpaqueMemberHmac(syntheticKey, `test-challenge-candidate-${i + 1}`)
  );
  const classes = [
    ...Array(6).fill(R2_1_FAILURE_CLASSES[0]),
    ...Array(6).fill(R2_1_FAILURE_CLASSES[1]),
    ...Array(6).fill(R2_1_FAILURE_CLASSES[2]),
  ];
  const attempts = classes.map((fc, i) => ({
    attemptId: `challenge-attempt-${String(i + 1).padStart(2, '0')}`,
    failureClass: fc,
    attemptOrderIndex: i + 1,
    sourcePacketReferenceHash: 'sha256:' + String(i + 1).padStart(2, '0') + '0'.repeat(62),
    sourceCandidateMemberReferenceHash: sourceHashes[i],
    constructionArtifactHash: 'sha256:' + String(i + 1).padStart(2, '0').repeat(32),
    transformationSpecHash: transSpecSha,
    adjudicatorAJudgment: 'SEVERE',
    adjudicatorBJudgment: 'SEVERE',
    qualificationState: 'QUALIFIES_UNANIMOUS_SEVERE',
  }));

  const attemptManifestObj = {
    schemaVersion: 'challenge-attempt-manifest.v1',
    manifestId: 'challenge-attempt-manifest.test-fixture',
    protocolId: 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1',
    totalAttempts: 18,
    attemptsPerClass: 6,
    failureClasses: [...R2_1_FAILURE_CLASSES],
    attempts,
  };
  const attemptManifestPath = path.join(scratchPath, 'challenge-attempt-manifest.json');
  const attemptManifestContent = JSON.stringify(attemptManifestObj, null, 2);
  fs.writeFileSync(attemptManifestPath, attemptManifestContent, 'utf8');
  const attemptManifestSha = 'sha256:' + computeSha256(Buffer.from(attemptManifestContent));
  const relAttemptManifest = path.join(relScratch, 'challenge-attempt-manifest.json');

  // 3. Qualification Manifest
  const evalResult = evaluateChallengeArmQualification(attempts);
  const qualManifestObj = {
    schemaVersion: 'challenge-qualification-manifest.v1',
    qualificationManifestId: 'challenge-qualification-manifest.test-fixture',
    protocolId: 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1',
    attemptManifestPath: relAttemptManifest,
    attemptManifestSha256: attemptManifestSha,
    qualificationStatus: 'READY',
    thirdHumanRescue: false,
    totalQualifying: 12,
    qualifyingPerClass: evalResult.qualifyingPerClass,
    qualifyingCases: evalResult.qualifyingCases,
    nonqualifyingProvenance: evalResult.nonqualifyingProvenance,
  };
  const qualManifestPath = path.join(scratchPath, 'challenge-qualification-manifest.json');
  const qualManifestContent = JSON.stringify(qualManifestObj, null, 2);
  fs.writeFileSync(qualManifestPath, qualManifestContent, 'utf8');
  const qualManifestSha = 'sha256:' + computeSha256(Buffer.from(qualManifestContent));
  const relQualManifest = path.join(relScratch, 'challenge-qualification-manifest.json');

  // 4. Replacement Holdout
  const holdoutMemberHashes = Array.from(
    { length: 100 },
    (_, i) => deriveOpaqueMemberHmac(syntheticKey, `holdout-candidate-${i + 1}`)
  );
  const holdoutMemberSetHash = computeOpaqueMemberReferenceSetHash(holdoutMemberHashes);
  const holdoutObj = {
    schemaVersion: 'replacement-holdout-commitment.v1',
    commitmentId: 'replacement-holdout-commitment.test-fixture',
    protocolId: 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1',
    opaqueMembershipHash: 'sha256:' + 'b'.repeat(64),
    opaqueMemberReferenceSetHash: holdoutMemberSetHash,
    deterministicOrderHash: 'sha256:' + 'c'.repeat(64),
    candidateCount: 100,
    derivationScheme: R2_1_DERIVATION_SCHEME,
    derivationVersion: R2_1_DERIVATION_VERSION,
    derivationKeyCommitment: keyCommitment,
    sealingMethod: 'SHA256_CANONICAL_MERKLE_MOCK',
    sealingVersion: '1.0',
    custodianId: 'personnel-custodian',
    sealedAt: '2026-09-20T18:00:00Z',
    integrityStatus: 'SEALED_AND_ISOLATED',
  };
  const holdoutPath = path.join(scratchPath, 'replacement-holdout-commitment.json');
  const holdoutContent = JSON.stringify(holdoutObj, null, 2);
  fs.writeFileSync(holdoutPath, holdoutContent, 'utf8');
  const holdoutSha = 'sha256:' + computeSha256(Buffer.from(holdoutContent));
  const relHoldout = path.join(relScratch, 'replacement-holdout-commitment.json');

  // 5. Authoritative Cohort Sources
  const devCandidates = ['cand-dev-01', 'cand-dev-02', 'cand-dev-03'];
  const devCandidatesPath = path.join(scratchPath, 'dev-candidates.json');
  const devCandidatesContent = JSON.stringify(devCandidates, null, 2);
  fs.writeFileSync(devCandidatesPath, devCandidatesContent, 'utf8');
  const devCandidatesSha = 'sha256:' + computeSha256(Buffer.from(devCandidatesContent));
  const relDevCandidates = path.join(relScratch, 'dev-candidates.json');
  const devHashes = devCandidates.map((c) => deriveOpaqueMemberHmac(syntheticKey, c)).sort();

  const retroCandidates = ['cand-retro-01', 'cand-retro-02', 'cand-retro-03'];
  const retroCandidatesPath = path.join(scratchPath, 'retro-candidates.json');
  const retroCandidatesContent = JSON.stringify(retroCandidates, null, 2);
  fs.writeFileSync(retroCandidatesPath, retroCandidatesContent, 'utf8');
  const retroCandidatesSha = 'sha256:' + computeSha256(Buffer.from(retroCandidatesContent));
  const relRetroCandidates = path.join(relScratch, 'retro-candidates.json');
  const retroHashes = retroCandidates.map((c) => deriveOpaqueMemberHmac(syntheticKey, c)).sort();

  const prodCandidates = ['cand-prod-01', 'cand-prod-02', 'cand-prod-03'];
  const prodCandidatesPath = path.join(scratchPath, 'prod-candidates.json');
  const prodCandidatesContent = JSON.stringify(prodCandidates, null, 2);
  fs.writeFileSync(prodCandidatesPath, prodCandidatesContent, 'utf8');
  const prodCandidatesSha = 'sha256:' + computeSha256(Buffer.from(prodCandidatesContent));
  const relProdCandidates = path.join(relScratch, 'prod-candidates.json');
  const prodHashes = prodCandidates.map((c) => deriveOpaqueMemberHmac(syntheticKey, c)).sort();

  // 6. Exclusion Pool
  const poolObj = {
    schemaVersion: 'challenge-source-exclusion.v1',
    manifestId: 'challenge-source-exclusion.test-fixture',
    protocolId: 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1',
    challengeSourcePoolId: 'test-severe-challenge-pool-01',
    derivationScheme: R2_1_DERIVATION_SCHEME,
    derivationVersion: R2_1_DERIVATION_VERSION,
    derivationKeyCommitment: keyCommitment,
    challengeSourceMemberHashes: sourceHashes,
    prohibitedCohorts: {
      developmentCohort: {
        cohortName: 'verifier-v1.4-development',
        sourceMembershipCommitment: {
          path: relDevCandidates,
          sha256: devCandidatesSha,
          candidateCount: 3,
          derivationScheme: R2_1_DERIVATION_SCHEME,
          derivationVersion: R2_1_DERIVATION_VERSION,
          derivationKeyCommitment: keyCommitment,
        },
        derivationScheme: R2_1_DERIVATION_SCHEME,
        derivationVersion: R2_1_DERIVATION_VERSION,
        derivationKeyCommitment: keyCommitment,
        opaqueMemberHashes: devHashes,
      },
      retrospectiveV14Cohort: {
        cohortName: 'verifier-v1.4-retrospective-continuation',
        sourceMembershipCommitment: {
          path: relRetroCandidates,
          sha256: retroCandidatesSha,
          candidateCount: 3,
          derivationScheme: R2_1_DERIVATION_SCHEME,
          derivationVersion: R2_1_DERIVATION_VERSION,
          derivationKeyCommitment: keyCommitment,
        },
        derivationScheme: R2_1_DERIVATION_SCHEME,
        derivationVersion: R2_1_DERIVATION_VERSION,
        derivationKeyCommitment: keyCommitment,
        opaqueMemberHashes: retroHashes,
      },
      currentProductionCohort: {
        cohortName: 'scale-tranche-1-production',
        sourceMembershipCommitment: {
          path: relProdCandidates,
          sha256: prodCandidatesSha,
          candidateCount: 3,
          derivationScheme: R2_1_DERIVATION_SCHEME,
          derivationVersion: R2_1_DERIVATION_VERSION,
          derivationKeyCommitment: keyCommitment,
        },
        derivationScheme: R2_1_DERIVATION_SCHEME,
        derivationVersion: R2_1_DERIVATION_VERSION,
        derivationKeyCommitment: keyCommitment,
        opaqueMemberHashes: prodHashes,
      },
      replacementProspectiveHoldout: {
        cohortName: 'replacement-prospective-holdout',
        candidateCount: 100,
        derivationScheme: R2_1_DERIVATION_SCHEME,
        derivationVersion: R2_1_DERIVATION_VERSION,
        derivationKeyCommitment: keyCommitment,
        opaqueMemberHashes: holdoutMemberHashes,
      },
    },
    custodianDerivationAttestation: {
      custodianId: 'personnel-custodian',
      attestationStatement: 'CUSTODIAN_ATTESTS_UNIFORM_HMAC_DERIVATION_ACROSS_ALL_COHORTS',
      attestedAt: '2026-09-20T18:00:00Z',
    },
    exclusionVerificationStatus: 'DISJOINT_EXCLUSION_PROVEN',
  };
  const poolPath = path.join(scratchPath, 'challenge-source-exclusion.json');
  const poolContent = JSON.stringify(poolObj, null, 2);
  fs.writeFileSync(poolPath, poolContent, 'utf8');
  const poolSha = 'sha256:' + computeSha256(Buffer.from(poolContent));
  const relPool = path.join(relScratch, 'challenge-source-exclusion.json');

  // 7. Human Resource Confirmation
  const hrObj = {
    schemaVersion: 'human-resource-confirmation.v1',
    confirmationId: 'human-resource-confirmation.test-fixture',
    protocolId: 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1',
    requiredDistinctCount: 8,
    allRolesDistinct: true,
    roleAssignments: {
      independent_custodian: 'personnel-custodian',
      challenge_construction_author: 'personnel-author',
      challenge_adjudicator_A: 'personnel-adj-a',
      challenge_adjudicator_B: 'personnel-adj-b',
      natural_primary_adjudicator: 'personnel-primary',
      natural_QA_adjudicator: 'personnel-qa',
      natural_reconciliation_adjudicator: 'personnel-reconciler',
      verifier_operator: 'personnel-operator',
    },
  };
  const hrPath = path.join(scratchPath, 'human-resource-confirmation.json');
  const hrContent = JSON.stringify(hrObj, null, 2);
  fs.writeFileSync(hrPath, hrContent, 'utf8');
  const hrSha = 'sha256:' + computeSha256(Buffer.from(hrContent));
  const relHr = path.join(relScratch, 'human-resource-confirmation.json');

  // 8. Runtime Dependency Declaration
  const builderSha = 'sha256:de201c6695d8198aac7059ceab1e1630cca9db9448b68c62a93a46137e98287c';
  const rtObj = {
    schemaVersion: 'runtime-dependency-declaration.v1',
    declarationId: 'runtime-dependency-declaration.test-fixture',
    protocolId: 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1',
    deterministicLintFindingsDisposition: 'UNIVERSALLY_ABSENT',
    allSemanticDependenciesDeclared: true,
    dependencies: [
      {
        reference: 'catalogue-pipeline/scripts/scaleTranche1Plan.mjs',
        dependencyType: 'source_code_file',
        sha256: builderSha,
        semanticPayloadImpact: true,
        required: true,
        disposition: 'FROZEN_BUILDER',
      },
    ],
  };
  const rtPath = path.join(scratchPath, 'runtime-dependency-declaration.json');
  const rtContent = JSON.stringify(rtObj, null, 2);
  fs.writeFileSync(rtPath, rtContent, 'utf8');
  const rtSha = 'sha256:' + computeSha256(Buffer.from(rtContent));
  const relRt = path.join(relScratch, 'runtime-dependency-declaration.json');

  // 9. Analysis Plan
  const planObj = {
    schemaVersion: 'analysis-plan.v1',
    planId: 'analysis-plan.test-fixture',
    protocolId: 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1',
    naturalArmRules: {
      minimumCleanDenominator: 20,
      minimumMinorDenominator: 20,
      maximumValidNaturalPackets: 100,
      minorRateGateFormula: 'minorLowRiskCount <= floor(0.10 * humanMinorCount)',
      cleanRateGateFormula: 'cleanHighRiskCount <= floor(0.10 * humanCleanCount)',
      fixedCountRuleRejected: true,
    },
    challengeArmRules: {
      qualifyingCaseCount: 12,
      permittedSevereEscapes: 0,
      immediateTerminationOnEscape: true,
    },
    outcomeRules: {
      passDefinition: 'ZERO_CHALLENGE_ESCAPES_AND_ZERO_NATURAL_SEVERE_ESCAPES_AND_BOTH_TERMINAL_RATES_PASS_AND_ZERO_TECHNICAL_ABORT',
      failDefinition: 'ANY_SEVERE_ESCAPE_OR_TERMINAL_NATURAL_ERROR_RATE_EXCEEDS_10_PERCENT',
      inconclusiveDefinition: 'INSUFFICIENT_QUALIFYING_CHALLENGES_OR_NATURAL_DENOMINATOR_BELOW_20_AT_PACKET_100',
      technicalAbortDefinition: 'ANY_INTEGRITY_VIOLATION_INVALIDATES_ENTIRE_RUN',
    },
  };
  const planPath = path.join(scratchPath, 'analysis-plan.json');
  const planContent = JSON.stringify(planObj, null, 2);
  fs.writeFileSync(planPath, planContent, 'utf8');
  const planSha = 'sha256:' + computeSha256(Buffer.from(planContent));
  const relPlan = path.join(relScratch, 'analysis-plan.json');

  // 10. Operator Log Schema
  const opLogSchemaPath = path.join(scratchPath, 'operator-log.schema.v1.json');
  const opLogSchemaSource = fs.readFileSync(
    path.join(workspaceRoot, 'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/operator-log.schema.v1.json'),
    'utf8'
  );
  fs.writeFileSync(opLogSchemaPath, opLogSchemaSource, 'utf8');
  const opLogSchemaSha = 'sha256:' + computeSha256(Buffer.from(opLogSchemaSource));
  const relOpLogSchema = path.join(relScratch, 'operator-log.schema.v1.json');

  // Git commit inside tempRepoDir
  execFileSync('git', ['init'], { cwd: tempRepoDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Synthetic Committer'], { cwd: tempRepoDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'synthetic@moviemood.local'], { cwd: tempRepoDir, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: tempRepoDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'Synthetic freeze-preparation checkpoint commit'], { cwd: tempRepoDir, stdio: 'ignore' });
  const checkpointSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tempRepoDir }).toString('utf8').trim();

  // Build freeze record
  const freezeRecord = {
    schemaVersion: 'execution-freeze-record.v1',
    freezeId: 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1-freeze-synthetic-01',
    protocolId: 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1',
    status: 'EXECUTION_READY',
    governanceAuthority: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/V1_4_FINAL_SYNTHESIS_AND_GOVERNANCE.md',
    protocolCommitment: {
      path: R2_1_PROTOCOL_PATH,
      sha256: 'sha256:' + R2_1_PROTOCOL_SHA256,
    },
    manifestCommitment: {
      path: R2_1_MANIFEST_PATH,
      sha256: 'sha256:' + R2_1_MANIFEST_SHA256,
    },
    replacementHoldoutCommitment: {
      path: relHoldout,
      sha256: holdoutSha,
      opaqueMembershipHash: holdoutObj.opaqueMembershipHash,
      opaqueMemberReferenceSetHash: holdoutObj.opaqueMemberReferenceSetHash,
      deterministicOrderHash: holdoutObj.deterministicOrderHash,
      candidateCount: 100,
      sealingMethod: holdoutObj.sealingMethod,
      status: 'SEALED_AND_ISOLATED',
    },
    qaSeedCommitment: {
      qaSeedHash: 'sha256:' + 'd'.repeat(64),
      status: 'COMMITTED_BY_INDEPENDENT_CUSTODIAN',
    },
    challengePoolAndExclusionCommitment: {
      path: relPool,
      sha256: poolSha,
      status: 'COMMITTED_AND_EXCLUSION_PROVED',
    },
    challengeAttemptManifestCommitment: {
      path: relAttemptManifest,
      sha256: attemptManifestSha,
      totalAttempts: 18,
      status: 'ALL_18_ATTEMPTS_LABELED',
    },
    challengeTransformationSpecCommitment: {
      path: relTransSpec,
      sha256: transSpecSha,
      status: 'FROZEN_BEFORE_CONSTRUCTION',
    },
    challengeQualificationManifestCommitment: {
      path: relQualManifest,
      sha256: qualManifestSha,
      totalQualifying: 12,
      qualificationRule: 'BOTH_INITIAL_HUMANS_SEVERE',
      thirdHumanRescue: false,
      status: 'READY',
    },
    runtimeDependencyDeclarationCommitment: {
      path: relRt,
      sha256: rtSha,
      deterministicLintFindings: 'UNIVERSALLY_ABSENT',
      status: 'DECLARED_AND_BOUND',
    },
    analysisPlanCommitment: {
      path: relPlan,
      sha256: planSha,
      rateRuleFormula: 'errorCount <= floor(0.10 * realizedHumanLabelCount)',
      status: 'PREREGISTERED',
    },
    operatorLogSchemaCommitment: {
      path: relOpLogSchema,
      sha256: opLogSchemaSha,
      retryRule: 'retryCount == 0',
      status: 'BOUND',
    },
    fixedExecutionOrderCommitment: {
      interArmSequencing: 'qualifying_challenges_first_then_natural_stream',
      challengeOrderHash: computeChallengeExecutionOrderHash(evalResult.qualifyingCases),
      naturalOrderHash: holdoutObj.deterministicOrderHash,
      status: 'ORDER_LOCKED',
    },
    humanResourceConfirmationCommitment: {
      path: relHr,
      sha256: hrSha,
      requiredDistinctPeople: 8,
      status: 'CONFIRMED',
    },
    frozenModelConfigurationCommitment: {
      provider: 'google-gemini-developer-api',
      modelId: 'gemini-3.8-flash',
      thinkingLevel: 'low',
      temperature: 0.0,
      maxOutputTokens: 6144,
      timeoutMs: 30000,
      automaticRetries: 0,
      fallbackProhibited: true,
    },
    inputContractCommitments: {
      verifierInputBuilder: {
        path: 'catalogue-pipeline/scripts/scaleTranche1Plan.mjs',
        sha256: 'sha256:de201c6695d8198aac7059ceab1e1630cca9db9448b68c62a93a46137e98287c',
      },
      surfaceAndLeakageContract: {
        path: 'catalogue-pipeline/scripts/runVerifierV13RetrospectiveReplay.mjs',
        sha256: 'sha256:3976a45b6e0655599c97bb560d6463ff78715a68b676225d117113a5f7382690',
      },
      blindPacketSchema: {
        path: 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/blind-human-review-packet.schema.v1.json',
        sha256: 'sha256:6bae3f04c4fc8d80d03e86adc389fb68a83b79098209b60fc498c59e0a4af257',
      },
      requiredSurfaces: [
        'facts',
        'acceptedSemanticClassification',
        'semanticBoundaryFlags',
        'allowedSourceMaterial',
        'spoilerBoundaryRules',
        'copyConstraints',
        'visibleEditorialCopy',
      ],
    },
    freezeValidationToolchainCommitment: {
      path: toolchainManifestRel,
      sha256: toolchainManifestSha,
      status: 'VERIFIED_DETERMINISTIC_PROVENANCE',
    },
    freezePreparationCheckpointCommit: checkpointSha,
    freezeMetadata: {
      createdAt: '2026-09-20T18:00:00Z',
      preparedByRole: 'INDEPENDENT_PREPARATION_INFRASTRUCTURE',
      custodianSignoffStatus: 'SIGNED_EXECUTION_FREEZE_AWAITING_SEPARATE_AUTHORIZATION',
    },
  };

  return {
    tempRepoDir,
    checkpointSha,
    freezeRecord,
    toolchainManifestObj,
    toolchainManifestSha,
    toolchainManifestRel,
    paths: {
      attemptManifestPath,
      qualManifestPath,
      poolPath,
      holdoutPath,
      devCandidatesPath,
    },
    objs: {
      attemptManifestObj,
      qualManifestObj,
      poolObj,
      holdoutObj,
    },
    cleanup: () => fs.rmSync(tempRepoDir, { recursive: true, force: true }),
  };
}

// =========================================================================
// BASIC STRUCTURAL AND EXISTING TESTS
// =========================================================================

test('1. template JSON conforms to PREPARATION_TEMPLATE requirements', () => {
  const result = validateProspectiveFreezeRecord(templateJson, { workspaceRoot });
  assert.equal(result.status, 'PREPARATION_TEMPLATE_VALID');
  assert.equal(result.isExecutionReady, false);
});

test('2. template cannot be validated as EXECUTION_READY', () => {
  assert.throws(
    () => validateProspectiveFreezeRecord(templateJson, { workspaceRoot, requireExecutionReady: true }),
    /Freeze package is in PREPARATION_TEMPLATE status, but EXECUTION_READY is required/
  );
});

test('3. human resource confirmation rejects non-8 distinct personnel', () => {
  const duplicateAdj = {
    roleAssignments: {
      independent_custodian: 'p-1',
      challenge_construction_author: 'p-2',
      challenge_adjudicator_A: 'p-3',
      challenge_adjudicator_B: 'p-3',
      natural_primary_adjudicator: 'p-4',
      natural_QA_adjudicator: 'p-5',
      natural_reconciliation_adjudicator: 'p-6',
      verifier_operator: 'p-7',
    },
  };
  assert.throws(() => validateHumanResourceConfirmation(duplicateAdj), /requires exactly 8 distinct personnel/);
});

test('4. challenge qualification requires unanimous SEVERE (fewer than 4 qualifying in a class yields INCONCLUSIVE)', () => {
  const attempts = Array(18).fill(null).map((_, i) => ({
    attemptId: `challenge-attempt-${String(i + 1).padStart(2, '0')}`,
    failureClass: R2_1_FAILURE_CLASSES[Math.floor(i / 6)],
    attemptOrderIndex: i + 1,
    constructionArtifactHash: 'sha256:' + 'a'.repeat(64),
    adjudicatorAJudgment: i < 3 ? 'MINOR' : 'SEVERE',
    adjudicatorBJudgment: i < 3 ? 'MINOR' : 'SEVERE',
    qualificationState: i < 3 ? 'DISQUALIFIED_NON_SEVERE' : 'QUALIFIES_UNANIMOUS_SEVERE',
  }));
  const res = evaluateChallengeArmQualification(attempts);
  assert.equal(res.status, 'INCONCLUSIVE_CHALLENGE_QUALIFICATION');
});

// =========================================================================
// GAP 1: SCHEMA VALIDATION TESTS
// =========================================================================

test('Gap 1.1: freeze record with wrong schemaVersion fails schema validation', () => {
  const { freezeRecord } = createRealSyntheticFixtureBundle();
  freezeRecord.schemaVersion = 'wrong.v2';
  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot }),
    /Schema validation failed.*schemaVersion|Unexpected schemaVersion/
  );
  cleanScratchDir();
});

test('Gap 1.2: freeze record with wrong protocolId fails schema validation', () => {
  const { freezeRecord } = createRealSyntheticFixtureBundle();
  freezeRecord.protocolId = 'wrong-protocol-id.r2';
  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot }),
    /Schema validation failed.*protocolId|Unexpected protocolId/
  );
  cleanScratchDir();
});

test('Gap 1.3: freeze record with unexpected additional property fails schema validation', () => {
  const { freezeRecord } = createRealSyntheticFixtureBundle();
  freezeRecord.unexpectedExtraKey = 'malicious';
  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot }),
    /Schema validation failed.*unexpected additional property 'unexpectedExtraKey'/
  );
  cleanScratchDir();
});

test('Gap 1.4: replacement holdout with wrong schemaVersion fails schema validation', () => {
  const { freezeRecord, paths, objs } = createRealSyntheticFixtureBundle();
  objs.holdoutObj.schemaVersion = 'replacement-holdout-commitment.v2';
  const content = JSON.stringify(objs.holdoutObj, null, 2);
  fs.writeFileSync(paths.holdoutPath, content, 'utf8');
  freezeRecord.replacementHoldoutCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(content));

  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /Schema validation failed.*schemaVersion|Holdout commitment schemaVersion mismatch/
  );
  cleanScratchDir();
});

test('Gap 1.5: replacement holdout with wrong protocolId fails schema validation', () => {
  const { freezeRecord, paths, objs } = createRealSyntheticFixtureBundle();
  objs.holdoutObj.protocolId = 'source-boundary-risk-verifier.v1.4-prospective-validation.r2';
  const content = JSON.stringify(objs.holdoutObj, null, 2);
  fs.writeFileSync(paths.holdoutPath, content, 'utf8');
  freezeRecord.replacementHoldoutCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(content));

  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /Schema validation failed.*protocolId|Holdout commitment protocolId mismatch/
  );
  cleanScratchDir();
});

test('Gap 1.6: replacement holdout with invalid hash strings fails schema validation', () => {
  const { freezeRecord, paths, objs } = createRealSyntheticFixtureBundle();
  objs.holdoutObj.opaqueMembershipHash = 'invalid-hash-not-sha256';
  const content = JSON.stringify(objs.holdoutObj, null, 2);
  fs.writeFileSync(paths.holdoutPath, content, 'utf8');
  freezeRecord.replacementHoldoutCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(content));

  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /Schema validation failed.*opaqueMembershipHash/
  );
  cleanScratchDir();
});

test('Gap 1.7: replacement holdout with invalid integrityStatus enum fails schema validation', () => {
  const { freezeRecord, paths, objs } = createRealSyntheticFixtureBundle();
  objs.holdoutObj.integrityStatus = 'COMPROMISED_ARBITRARY_STATUS';
  const content = JSON.stringify(objs.holdoutObj, null, 2);
  fs.writeFileSync(paths.holdoutPath, content, 'utf8');
  freezeRecord.replacementHoldoutCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(content));

  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /Schema validation failed.*integrityStatus/
  );
  cleanScratchDir();
});

test('Gap 1.8: replacement holdout with nested extra object containing candidateId/title fails closed', () => {
  const { freezeRecord, paths, objs } = createRealSyntheticFixtureBundle();
  objs.holdoutObj.extraContent = {
    nestedCandidate: {
      candidateId: 'movie-12345',
      title: 'Inception',
    },
  };
  const content = JSON.stringify(objs.holdoutObj, null, 2);
  fs.writeFileSync(paths.holdoutPath, content, 'utf8');
  freezeRecord.replacementHoldoutCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(content));

  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /SECURITY_VIOLATION.*forbidden field 'candidateId'|unexpected additional property 'extraContent'/
  );
  cleanScratchDir();
});

test('Gap 1.9: challenge attempt manifest with missing required attempts field fails schema validation', () => {
  const { freezeRecord, paths, objs } = createRealSyntheticFixtureBundle();
  delete objs.attemptManifestObj.attempts;
  const content = JSON.stringify(objs.attemptManifestObj, null, 2);
  fs.writeFileSync(paths.attemptManifestPath, content, 'utf8');
  freezeRecord.challengeAttemptManifestCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(content));

  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /missing required property 'attempts'/
  );
  cleanScratchDir();
});

test('Gap 1.10: challenge qualification manifest with invalid totalQualifying fails schema validation', () => {
  const { freezeRecord, paths, objs } = createRealSyntheticFixtureBundle();
  objs.qualManifestObj.totalQualifying = 15;
  const content = JSON.stringify(objs.qualManifestObj, null, 2);
  fs.writeFileSync(paths.qualManifestPath, content, 'utf8');
  freezeRecord.challengeQualificationManifestCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(content));

  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /Schema validation failed.*totalQualifying.*> maximum/
  );
  cleanScratchDir();
});

test('Gap 1.11: human resource confirmation with wrong requiredDistinctCount fails schema validation', () => {
  const { freezeRecord, paths, objs } = createRealSyntheticFixtureBundle();
  objs.hrObj.requiredDistinctCount = 7;
  const content = JSON.stringify(objs.hrObj, null, 2);
  fs.writeFileSync(paths.hrPath, content, 'utf8');
  freezeRecord.humanResourceConfirmationCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(content));

  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /Schema validation failed.*requiredDistinctCount.*expected const 8/
  );
  cleanScratchDir();
});

test('Gap 1.12: analysis plan missing naturalArmRules fails schema validation', () => {
  const { freezeRecord, paths, objs } = createRealSyntheticFixtureBundle();
  delete objs.planObj.naturalArmRules;
  const content = JSON.stringify(objs.planObj, null, 2);
  fs.writeFileSync(paths.planPath, content, 'utf8');
  freezeRecord.analysisPlanCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(content));

  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /missing required property 'naturalArmRules'/
  );
  cleanScratchDir();
});

// =========================================================================
// GAP 2: SYMLINK ESCAPE TESTS
// =========================================================================

test('Gap 2.1: intermediate directory symlink escaping workspaceRoot fails closed', () => {
  cleanScratchDir();
  fs.mkdirSync(scratchDir, { recursive: true });

  const outsideDir = path.join(os.tmpdir(), 'movie-mood-outside-' + Date.now());
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'secret payload', 'utf8');

  try {
    const symlinkDir = path.join(scratchDir, 'escaped-dir-link');
    fs.symlinkSync(outsideDir, symlinkDir);

    const testFileRef = path.join(path.relative(workspaceRoot, symlinkDir), 'secret.txt');

    assert.throws(
      () => resolveSafeWorkspacePath(testFileRef, workspaceRoot),
      /SECURITY_VIOLATION: Path escapes workspace root via symlink/
    );
  } finally {
    fs.rmSync(outsideDir, { recursive: true, force: true });
    cleanScratchDir();
  }
});

test('Gap 2.2: nested intermediate symlink escape fails closed', () => {
  cleanScratchDir();
  fs.mkdirSync(scratchDir, { recursive: true });

  const outsideDir = path.join(os.tmpdir(), 'movie-mood-outside-nested-' + Date.now());
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(path.join(outsideDir, 'deep.txt'), 'deep secret', 'utf8');

  try {
    const innerDir = path.join(scratchDir, 'inner');
    fs.mkdirSync(innerDir, { recursive: true });

    const deepSymlink = path.join(innerDir, 'link-to-outside');
    fs.symlinkSync(outsideDir, deepSymlink);

    const testFileRef = path.join(path.relative(workspaceRoot, deepSymlink), 'deep.txt');

    assert.throws(
      () => resolveSafeWorkspacePath(testFileRef, workspaceRoot),
      /SECURITY_VIOLATION: Path escapes workspace root via symlink/
    );
  } finally {
    fs.rmSync(outsideDir, { recursive: true, force: true });
    cleanScratchDir();
  }
});

test('Gap 2.3: internal symlink completely within workspaceRoot resolves safely', () => {
  cleanScratchDir();
  fs.mkdirSync(scratchDir, { recursive: true });

  const realTargetFile = path.join(scratchDir, 'real-target.txt');
  fs.writeFileSync(realTargetFile, 'safe local content', 'utf8');

  const internalSymlink = path.join(scratchDir, 'internal-link.txt');
  fs.symlinkSync(realTargetFile, internalSymlink);

  const relInternalLink = path.relative(workspaceRoot, internalSymlink);
  const resolved = resolveSafeWorkspacePath(relInternalLink, workspaceRoot);
  assert.equal(fs.readFileSync(resolved, 'utf8'), 'safe local content');
  cleanScratchDir();
});

// =========================================================================
// GAP 3: casePacketHash CROSS-CHECK
// =========================================================================

test('Gap 3: mutates only casePacketHash in challenge qualification manifest -> FAIL-CLOSED', () => {
  const { freezeRecord, paths, objs } = createRealSyntheticFixtureBundle();

  // Keep correct attemptId, order, failureClass; mutate ONLY casePacketHash
  objs.qualManifestObj.qualifyingCases[0].casePacketHash = 'sha256:' + '0'.repeat(64);
  const qualContent = JSON.stringify(objs.qualManifestObj, null, 2);
  fs.writeFileSync(paths.qualManifestPath, qualContent, 'utf8');

  // Recompute file SHA and update freeze commitment SHA
  freezeRecord.challengeQualificationManifestCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(qualContent));

  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /Qualifying case at index 0 does not match deterministic first-four recomputation.*casePacketHash/
  );
  cleanScratchDir();
});

// =========================================================================
// GAP 4: NONQUALIFYING PROVENANCE CROSS-CHECK
// =========================================================================

test('Gap 4.1: omitted nonqualifying attempt from nonqualifyingProvenance fails closed', () => {
  const { freezeRecord, paths, objs } = createRealSyntheticFixtureBundle();
  // Attempt to remove nonqualifying entries
  objs.qualManifestObj.nonqualifyingProvenance = objs.qualManifestObj.nonqualifyingProvenance.slice(0, 2);
  const qualContent = JSON.stringify(objs.qualManifestObj, null, 2);
  fs.writeFileSync(paths.qualManifestPath, qualContent, 'utf8');
  freezeRecord.challengeQualificationManifestCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(qualContent));

  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /Qualification manifest nonqualifyingProvenance length mismatch/
  );
  cleanScratchDir();
});

test('Gap 4.2: changed disposition reason in nonqualifyingProvenance fails closed', () => {
  const { freezeRecord, paths, objs } = createRealSyntheticFixtureBundle();
  objs.qualManifestObj.nonqualifyingProvenance[0].dispositionReason = 'DISQUALIFIED_DISAGREEMENT';
  const qualContent = JSON.stringify(objs.qualManifestObj, null, 2);
  fs.writeFileSync(paths.qualManifestPath, qualContent, 'utf8');
  freezeRecord.challengeQualificationManifestCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(qualContent));

  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /Nonqualifying provenance entry at index 0 does not match deterministic recomputation.*reason/
  );
  cleanScratchDir();
});

test('Gap 4.3: inserted fake entry in nonqualifyingProvenance fails closed', () => {
  const { freezeRecord, paths, objs } = createRealSyntheticFixtureBundle();
  objs.qualManifestObj.nonqualifyingProvenance.push({
    attemptId: 'challenge-attempt-99',
    failureClass: R2_1_FAILURE_CLASSES[0],
    attemptOrderIndex: 19,
    dispositionReason: 'SURPLUS_QUALIFYING_BEYOND_FOUR',
  });
  const qualContent = JSON.stringify(objs.qualManifestObj, null, 2);
  fs.writeFileSync(paths.qualManifestPath, qualContent, 'utf8');
  freezeRecord.challengeQualificationManifestCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(qualContent));

  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /Qualification manifest nonqualifyingProvenance length mismatch/
  );
  cleanScratchDir();
});

// =========================================================================
// GAP 5: CHALLENGE SOURCE EXCLUSION TESTS
// =========================================================================

test('Gap 5.1: empty object or empty challengeSourceMemberHashes fails exclusion check', () => {
  const { freezeRecord, paths, objs } = createRealSyntheticFixtureBundle();
  objs.poolObj.challengeSourceMemberHashes = [];
  const content = JSON.stringify(objs.poolObj, null, 2);
  fs.writeFileSync(paths.poolPath, content, 'utf8');
  freezeRecord.challengePoolAndExclusionCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(content));

  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /challengeSourceMemberHashes must contain at least 18 entries|array length 0 < minItems 18/
  );
  cleanScratchDir();
});

test('Gap 5.2: challenge member overlaps prohibited development cohort fails closed', () => {
  const { freezeRecord, paths, objs } = createRealSyntheticFixtureBundle();
  objs.poolObj.challengeSourceMemberHashes[0] = objs.poolObj.prohibitedCohorts.developmentCohort.opaqueMemberHashes[0];
  const content = JSON.stringify(objs.poolObj, null, 2);
  fs.writeFileSync(paths.poolPath, content, 'utf8');
  freezeRecord.challengePoolAndExclusionCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(content));

  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /EXCLUSION_VIOLATION: Prohibited cohort 'developmentCohort'.*collides with challenge source pool/
  );
  cleanScratchDir();
});

test('Gap 5.3: challenge member overlaps prohibited retrospective cohort fails closed', () => {
  const { freezeRecord, paths, objs } = createRealSyntheticFixtureBundle();
  objs.poolObj.challengeSourceMemberHashes[1] = objs.poolObj.prohibitedCohorts.retrospectiveV14Cohort.opaqueMemberHashes[0];
  const content = JSON.stringify(objs.poolObj, null, 2);
  fs.writeFileSync(paths.poolPath, content, 'utf8');
  freezeRecord.challengePoolAndExclusionCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(content));

  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /EXCLUSION_VIOLATION: Prohibited cohort 'retrospectiveV14Cohort'.*collides with challenge source pool/
  );
  cleanScratchDir();
});

test('Gap 5.4: challenge member overlaps prohibited production cohort fails closed', () => {
  const { freezeRecord, paths, objs } = createRealSyntheticFixtureBundle();
  objs.poolObj.challengeSourceMemberHashes[2] = objs.poolObj.prohibitedCohorts.currentProductionCohort.opaqueMemberHashes[0];
  const content = JSON.stringify(objs.poolObj, null, 2);
  fs.writeFileSync(paths.poolPath, content, 'utf8');
  freezeRecord.challengePoolAndExclusionCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(content));

  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /EXCLUSION_VIOLATION: Prohibited cohort 'currentProductionCohort'.*collides with challenge source pool/
  );
  cleanScratchDir();
});

test('Gap 5.5: challenge member overlaps replacement prospective holdout fails closed', () => {
  const { freezeRecord, paths, objs } = createRealSyntheticFixtureBundle();
  objs.poolObj.challengeSourceMemberHashes[3] = objs.poolObj.prohibitedCohorts.replacementProspectiveHoldout.opaqueMemberHashes[0];
  const content = JSON.stringify(objs.poolObj, null, 2);
  fs.writeFileSync(paths.poolPath, content, 'utf8');
  freezeRecord.challengePoolAndExclusionCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(content));

  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /EXCLUSION_VIOLATION: replacementProspectiveHoldout member hash .* collides with challenge source pool/
  );
  cleanScratchDir();
});

// =========================================================================
// GAP 6: HOLDOUT SIZE REQUIREMENT (>= 100)
// =========================================================================

test('Gap 6.1: replacement holdout candidateCount 99 fails boundary check', () => {
  const { freezeRecord, paths, objs } = createRealSyntheticFixtureBundle();
  objs.holdoutObj.candidateCount = 99;
  const content = JSON.stringify(objs.holdoutObj, null, 2);
  fs.writeFileSync(paths.holdoutPath, content, 'utf8');
  freezeRecord.replacementHoldoutCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(content));
  freezeRecord.replacementHoldoutCommitment.candidateCount = 99;

  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /candidateCount must be at least 100|number 99 < minimum 100/
  );
  cleanScratchDir();
});

test('Gap 6.2: replacement holdout candidateCount 100 passes boundary check', () => {
  const { tempRepoDir, freezeRecord, cleanup } = createSyntheticGitRepoFixture();
  try {
    assert.equal(freezeRecord.replacementHoldoutCommitment.candidateCount, 100);
    const res = validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot: tempRepoDir, requireExecutionReady: true });
    assert.equal(res.status, 'EXECUTION_READY');
  } finally {
    cleanup();
  }
});

// =========================================================================
// GAP 7: QA SEED COMMITMENT VALIDATION
// =========================================================================

test('Gap 7.1: malformed qaSeedHash fails closed', () => {
  const { freezeRecord } = createRealSyntheticFixtureBundle();
  freezeRecord.qaSeedCommitment.qaSeedHash = 'invalid-seed-format';
  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /EXECUTION_READY requires a valid sha256:<64hex> qaSeedHash|qaSeedHash/
  );
  cleanScratchDir();
});

test('Gap 7.2: invalid qaSeedCommitment status fails closed', () => {
  const { freezeRecord } = createRealSyntheticFixtureBundle();
  freezeRecord.qaSeedCommitment.status = 'UNAUTHORIZED_GENERATION';
  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /EXECUTION_READY requires qaSeedCommitment\.status === 'COMMITTED_BY_INDEPENDENT_CUSTODIAN'/
  );
  cleanScratchDir();
});

test('Gap 7.3: raw seed exposed in qaSeedCommitment fails closed', () => {
  const { freezeRecord } = createRealSyntheticFixtureBundle();
  freezeRecord.qaSeedCommitment.rawSeed = 'my-secret-seed-42';
  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /SECURITY_VIOLATION: Raw QA seed value must not be exposed|unexpected additional property 'rawSeed'/
  );
  cleanScratchDir();
});

// =========================================================================
// GAP 8: TOOLCHAIN MANIFEST EXACTNESS
// =========================================================================

test('Gap 8.1: toolchain manifest missing a governed file fails closed', () => {
  const { freezeRecord, paths, objs } = createRealSyntheticFixtureBundle();
  delete objs.toolchainManifestObj.toolchainFiles['catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/challenge-source-exclusion.schema.v1.json'];
  const content = JSON.stringify(objs.toolchainManifestObj, null, 2);
  fs.writeFileSync(paths.toolchainManifestPath, content, 'utf8');
  freezeRecord.freezeValidationToolchainCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(content));

  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /Freeze validation toolchain manifest missing expected governed file/
  );
  cleanScratchDir();
});

test('Gap 8.2: toolchain manifest containing unexpected unapproved file fails closed', () => {
  const { freezeRecord, paths, objs } = createRealSyntheticFixtureBundle();
  objs.toolchainManifestObj.toolchainFiles['unapproved/rogue-script.mjs'] = 'sha256:' + 'f'.repeat(64);
  const content = JSON.stringify(objs.toolchainManifestObj, null, 2);
  fs.writeFileSync(paths.toolchainManifestPath, content, 'utf8');
  freezeRecord.freezeValidationToolchainCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(content));

  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /Freeze validation toolchain manifest contains unexpected unapproved file/
  );
  cleanScratchDir();
});

test('Gap 8.3: toolchain manifest wrong protocolId fails closed', () => {
  const { freezeRecord, paths, objs } = createRealSyntheticFixtureBundle();
  objs.toolchainManifestObj.protocolId = 'source-boundary-risk-verifier.v1.4-prospective-validation.r2';
  const content = JSON.stringify(objs.toolchainManifestObj, null, 2);
  fs.writeFileSync(paths.toolchainManifestPath, content, 'utf8');
  freezeRecord.freezeValidationToolchainCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(content));

  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /Toolchain manifest protocolId mismatch/
  );
  cleanScratchDir();
});

// =========================================================================
// GAP 9: TOOLCHAIN TRUST ANCHOR
// =========================================================================

test('Gap 9.1: missing freezePreparationCheckpointCommit in EXECUTION_READY fails closed', () => {
  const { freezeRecord } = createRealSyntheticFixtureBundle();
  delete freezeRecord.freezePreparationCheckpointCommit;
  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /missing required property 'freezePreparationCheckpointCommit'|EXECUTION_READY requires a valid 40-character hexadecimal freezePreparationCheckpointCommit/
  );
  cleanScratchDir();
});

test('Gap 9.2: invalid non-40-hex freezePreparationCheckpointCommit in EXECUTION_READY fails closed', () => {
  const { freezeRecord } = createRealSyntheticFixtureBundle();
  freezeRecord.freezePreparationCheckpointCommit = 'short-hash-123';
  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /EXECUTION_READY requires a valid 40-character hexadecimal freezePreparationCheckpointCommit|does not match pattern/
  );
  cleanScratchDir();
});

test('Gap 9.3: UNRESOLVED_PRE_EXECUTION_COMMITMENT in EXECUTION_READY fails closed', () => {
  const { freezeRecord } = createRealSyntheticFixtureBundle();
  freezeRecord.freezePreparationCheckpointCommit = 'UNRESOLVED_PRE_EXECUTION_COMMITMENT';
  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /contains unresolved placeholders/
  );
  cleanScratchDir();
});

// =========================================================================
// GAP 10: ACTUAL SCHEMA / PROTOCOL IDENTITIES
// =========================================================================

test('Gap 10: artifact from r2 protocol rejected even if structurally identical', () => {
  const { freezeRecord, paths, objs } = createRealSyntheticFixtureBundle();
  objs.rtObj.protocolId = 'source-boundary-risk-verifier.v1.4-prospective-validation.r2';
  const content = JSON.stringify(objs.rtObj, null, 2);
  fs.writeFileSync(paths.rtPath, content, 'utf8');
  freezeRecord.runtimeDependencyDeclarationCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(content));

  assert.throws(
    () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot, requireExecutionReady: true }),
    /Runtime dependency declaration protocolId mismatch|Schema validation failed.*protocolId/
  );
  cleanScratchDir();
});

// =========================================================================
// GAP 11: NATURAL RATE HELPER BOUNDS & IMPOSSIBLE STATES
// =========================================================================

test('Gap 11.1: validNaturalPackets > 100 fails impossible-state guard', () => {
  assert.throws(
    () => evaluateNaturalArmRateGate({
      humanCleanCount: 55,
      humanMinorCount: 55,
      cleanHighRiskCount: 2,
      minorLowRiskCount: 2,
      validNaturalPackets: 110,
    }),
    /IMPOSSIBLE_STATE: validNaturalPackets \(110\) exceeds maximum protocol bound of 100/
  );
});

test('Gap 11.2: humanCleanCount > validNaturalPackets fails impossible-state guard', () => {
  assert.throws(
    () => evaluateNaturalArmRateGate({
      humanCleanCount: 50,
      humanMinorCount: 10,
      cleanHighRiskCount: 2,
      minorLowRiskCount: 1,
      validNaturalPackets: 40,
    }),
    /IMPOSSIBLE_STATE: humanCleanCount \(50\) exceeds validNaturalPackets \(40\)/
  );
});

test('Gap 11.3: cleanHighRiskCount > humanCleanCount fails impossible-state guard', () => {
  assert.throws(
    () => evaluateNaturalArmRateGate({
      humanCleanCount: 20,
      humanMinorCount: 20,
      cleanHighRiskCount: 25,
      minorLowRiskCount: 1,
    }),
    /IMPOSSIBLE_STATE: cleanHighRiskCount \(25\) exceeds its denominator humanCleanCount \(20\)/
  );
});

test('Gap 11.4: minorLowRiskCount > humanMinorCount fails impossible-state guard', () => {
  assert.throws(
    () => evaluateNaturalArmRateGate({
      humanCleanCount: 20,
      humanMinorCount: 20,
      cleanHighRiskCount: 1,
      minorLowRiskCount: 25,
    }),
    /IMPOSSIBLE_STATE: minorLowRiskCount \(25\) exceeds its denominator humanMinorCount \(20\)/
  );
});

test('Gap 11.5: clean + minor sum > validNaturalPackets fails impossible-state guard', () => {
  assert.throws(
    () => evaluateNaturalArmRateGate({
      humanCleanCount: 30,
      humanMinorCount: 30,
      cleanHighRiskCount: 1,
      minorLowRiskCount: 1,
      validNaturalPackets: 50,
    }),
    /IMPOSSIBLE_STATE: sum of clean \(30\) and minor \(30\) exceeds validNaturalPackets \(50\)/
  );
});

// =========================================================================
// GAP A: GIT CHECKPOINT VERIFICATION TESTS
// =========================================================================

test('Gap A.1: random syntactically valid 40-hex checkpoint SHA fails closed', () => {
  const { tempRepoDir, toolchainManifestObj, toolchainManifestSha, toolchainManifestRel, cleanup } = createSyntheticGitRepoFixture();
  try {
    const fakeSha = 'e'.repeat(40);
    assert.throws(
      () => verifyFreezePreparationCheckpointCommit({
        commitSha: fakeSha,
        workspaceRoot: tempRepoDir,
        toolchainManifest: toolchainManifestObj,
        expectedToolchainSha: toolchainManifestSha,
        toolchainManifestRelPath: toolchainManifestRel,
      }),
      /does not exist as a commit object in repository history/
    );
  } finally {
    cleanup();
  }
});

test('Gap A.2: real temp-repo checkpoint passes verification', () => {
  const { tempRepoDir, checkpointSha, toolchainManifestObj, toolchainManifestSha, toolchainManifestRel, cleanup } = createSyntheticGitRepoFixture();
  try {
    const res = verifyFreezePreparationCheckpointCommit({
      commitSha: checkpointSha,
      workspaceRoot: tempRepoDir,
      toolchainManifest: toolchainManifestObj,
      expectedToolchainSha: toolchainManifestSha,
      toolchainManifestRelPath: toolchainManifestRel,
    });
    assert.equal(res.verified, true);
    assert.equal(res.commitSha, checkpointSha);
  } finally {
    cleanup();
  }
});

test('Gap A.3: toolchain byte mismatch at checkpoint commit fails closed', () => {
  const { tempRepoDir, toolchainManifestObj, toolchainManifestSha, toolchainManifestRel, cleanup } = createSyntheticGitRepoFixture();
  try {
    const targetFile = path.join(tempRepoDir, R2_1_EXPECTED_TOOLCHAIN_FILES[0]);
    fs.appendFileSync(targetFile, '\n// modified\n', 'utf8');
    execFileSync('git', ['commit', '-am', 'corrupt toolchain file'], { cwd: tempRepoDir, stdio: 'ignore' });
    const corruptedSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tempRepoDir }).toString('utf8').trim();

    assert.throws(
      () => verifyFreezePreparationCheckpointCommit({
        commitSha: corruptedSha,
        workspaceRoot: tempRepoDir,
        toolchainManifest: toolchainManifestObj,
        expectedToolchainSha: toolchainManifestSha,
        toolchainManifestRelPath: toolchainManifestRel,
      }),
      /SHA-256 mismatch/
    );
  } finally {
    cleanup();
  }
});

test('Gap A.4: governed file missing at checkpoint commit fails closed', () => {
  const { tempRepoDir, toolchainManifestObj, toolchainManifestSha, toolchainManifestRel, cleanup } = createSyntheticGitRepoFixture();
  try {
    const targetRel = R2_1_EXPECTED_TOOLCHAIN_FILES[0];
    execFileSync('git', ['rm', targetRel], { cwd: tempRepoDir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'remove toolchain file'], { cwd: tempRepoDir, stdio: 'ignore' });
    const missingFileSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tempRepoDir }).toString('utf8').trim();

    assert.throws(
      () => verifyFreezePreparationCheckpointCommit({
        commitSha: missingFileSha,
        workspaceRoot: tempRepoDir,
        toolchainManifest: toolchainManifestObj,
        expectedToolchainSha: toolchainManifestSha,
        toolchainManifestRelPath: toolchainManifestRel,
      }),
      /does not exist at checkpoint commit/
    );
  } finally {
    cleanup();
  }
});

test('Gap A.5: checkpoint commit not an ancestor of HEAD fails closed', () => {
  const { tempRepoDir, toolchainManifestObj, toolchainManifestSha, toolchainManifestRel, cleanup } = createSyntheticGitRepoFixture();
  try {
    execFileSync('git', ['checkout', '-b', 'orphan-branch'], { cwd: tempRepoDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tempRepoDir, 'orphan.txt'), 'orphan', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: tempRepoDir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'orphan commit'], { cwd: tempRepoDir, stdio: 'ignore' });
    const orphanSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tempRepoDir }).toString('utf8').trim();

    execFileSync('git', ['checkout', '-'], { cwd: tempRepoDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tempRepoDir, 'main.txt'), 'main commit', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: tempRepoDir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'main commit'], { cwd: tempRepoDir, stdio: 'ignore' });

    assert.throws(
      () => verifyFreezePreparationCheckpointCommit({
        commitSha: orphanSha,
        workspaceRoot: tempRepoDir,
        toolchainManifest: toolchainManifestObj,
        expectedToolchainSha: toolchainManifestSha,
        toolchainManifestRelPath: toolchainManifestRel,
      }),
      /is not an ancestor of current HEAD/
    );
  } finally {
    cleanup();
  }
});

// =========================================================================
// GAP B: ACTUAL CHALLENGE ATTEMPT SOURCE BINDING TESTS
// =========================================================================

test('Gap B.1: challenge attempt sourceCandidateMemberReferenceHash outside exclusion pool fails closed', () => {
  const { tempRepoDir, freezeRecord, cleanup } = createSyntheticGitRepoFixture();
  try {
    const attemptPath = path.join(tempRepoDir, freezeRecord.challengeAttemptManifestCommitment.path);
    const attemptJson = JSON.parse(fs.readFileSync(attemptPath, 'utf8'));
    attemptJson.attempts[0].sourceCandidateMemberReferenceHash = 'sha256:' + '9'.repeat(64);
    const updatedContent = JSON.stringify(attemptJson, null, 2);
    fs.writeFileSync(attemptPath, updatedContent, 'utf8');
    const newAttemptSha = 'sha256:' + computeSha256(Buffer.from(updatedContent));
    freezeRecord.challengeAttemptManifestCommitment.sha256 = newAttemptSha;

    const qualPath = path.join(tempRepoDir, freezeRecord.challengeQualificationManifestCommitment.path);
    const qualJson = JSON.parse(fs.readFileSync(qualPath, 'utf8'));
    qualJson.attemptManifestSha256 = newAttemptSha;
    const updatedQualContent = JSON.stringify(qualJson, null, 2);
    fs.writeFileSync(qualPath, updatedQualContent, 'utf8');
    freezeRecord.challengeQualificationManifestCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(updatedQualContent));

    assert.throws(
      () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot: tempRepoDir, requireExecutionReady: true }),
      /is not present in exclusion-proven challengeSourceMemberHashes/
    );
  } finally {
    cleanup();
  }
});

test('Gap B.2: duplicate challenge attempt sourceCandidateMemberReferenceHash fails closed', () => {
  const { tempRepoDir, freezeRecord, cleanup } = createSyntheticGitRepoFixture();
  try {
    const attemptPath = path.join(tempRepoDir, freezeRecord.challengeAttemptManifestCommitment.path);
    const attemptJson = JSON.parse(fs.readFileSync(attemptPath, 'utf8'));
    attemptJson.attempts[1].sourceCandidateMemberReferenceHash = attemptJson.attempts[0].sourceCandidateMemberReferenceHash;
    const updatedContent = JSON.stringify(attemptJson, null, 2);
    fs.writeFileSync(attemptPath, updatedContent, 'utf8');
    const newAttemptSha = 'sha256:' + computeSha256(Buffer.from(updatedContent));
    freezeRecord.challengeAttemptManifestCommitment.sha256 = newAttemptSha;

    const qualPath = path.join(tempRepoDir, freezeRecord.challengeQualificationManifestCommitment.path);
    const qualJson = JSON.parse(fs.readFileSync(qualPath, 'utf8'));
    qualJson.attemptManifestSha256 = newAttemptSha;
    const updatedQualContent = JSON.stringify(qualJson, null, 2);
    fs.writeFileSync(qualPath, updatedQualContent, 'utf8');
    freezeRecord.challengeQualificationManifestCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(updatedQualContent));

    assert.throws(
      () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot: tempRepoDir, requireExecutionReady: true }),
      /Challenge attempts must use exactly 18 distinct sourceCandidateMemberReferenceHash values/
    );
  } finally {
    cleanup();
  }
});

// =========================================================================
// GAP B2: MEMBER-LEVEL HOLDOUT DISJOINTNESS & COHORT GROUNDING TESTS
// =========================================================================

test('Gap B2.1: holdout aggregate member-reference-set commitment mismatch fails closed', () => {
  const { tempRepoDir, freezeRecord, cleanup } = createSyntheticGitRepoFixture();
  try {
    const holdoutPath = path.join(tempRepoDir, freezeRecord.replacementHoldoutCommitment.path);
    const holdoutJson = JSON.parse(fs.readFileSync(holdoutPath, 'utf8'));
    holdoutJson.opaqueMemberReferenceSetHash = 'sha256:' + '7'.repeat(64);
    const updatedContent = JSON.stringify(holdoutJson, null, 2);
    fs.writeFileSync(holdoutPath, updatedContent, 'utf8');
    freezeRecord.replacementHoldoutCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(updatedContent));
    freezeRecord.replacementHoldoutCommitment.opaqueMemberReferenceSetHash = holdoutJson.opaqueMemberReferenceSetHash;

    assert.throws(
      () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot: tempRepoDir, requireExecutionReady: true }),
      /Replacement holdout opaqueMemberReferenceSetHash mismatch/
    );
  } finally {
    cleanup();
  }
});

test('Gap B2.2: challenge source and replacement holdout member overlap fails closed', () => {
  const { tempRepoDir, freezeRecord, cleanup } = createSyntheticGitRepoFixture();
  try {
    const poolPath = path.join(tempRepoDir, freezeRecord.challengePoolAndExclusionCommitment.path);
    const poolJson = JSON.parse(fs.readFileSync(poolPath, 'utf8'));
    poolJson.prohibitedCohorts.replacementProspectiveHoldout.opaqueMemberHashes[0] = poolJson.challengeSourceMemberHashes[0];
    const updatedContent = JSON.stringify(poolJson, null, 2);
    fs.writeFileSync(poolPath, updatedContent, 'utf8');
    freezeRecord.challengePoolAndExclusionCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(updatedContent));

    assert.throws(
      () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot: tempRepoDir, requireExecutionReady: true }),
      /EXCLUSION_VIOLATION: replacementProspectiveHoldout member hash .* collides with challenge source pool/
    );
  } finally {
    cleanup();
  }
});

test('Gap B2.3: ungrounded development prohibited cohort membership fails closed', () => {
  const { tempRepoDir, freezeRecord, cleanup } = createSyntheticGitRepoFixture();
  try {
    const poolPath = path.join(tempRepoDir, freezeRecord.challengePoolAndExclusionCommitment.path);
    const poolJson = JSON.parse(fs.readFileSync(poolPath, 'utf8'));
    poolJson.prohibitedCohorts.developmentCohort.sourceMembershipCommitment.candidateCount = 4;
    const updatedContent = JSON.stringify(poolJson, null, 2);
    fs.writeFileSync(poolPath, updatedContent, 'utf8');
    freezeRecord.challengePoolAndExclusionCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(updatedContent));

    assert.throws(
      () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot: tempRepoDir, requireExecutionReady: true }),
      /must equal candidateCount|candidate count mismatch/
    );
  } finally {
    cleanup();
  }
});

// =========================================================================
// GAP C: CHALLENGE EXECUTION ORDER HASH TESTS
// =========================================================================

test('Gap C.1: arbitrary challengeOrderHash fails closed', () => {
  const { tempRepoDir, freezeRecord, cleanup } = createSyntheticGitRepoFixture();
  try {
    freezeRecord.fixedExecutionOrderCommitment.challengeOrderHash = 'sha256:' + '4'.repeat(64);
    assert.throws(
      () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot: tempRepoDir, requireExecutionReady: true }),
      /challengeOrderHash mismatch/
    );
  } finally {
    cleanup();
  }
});

test('Gap C.2: correctly recomputed challengeOrderHash matches expected encoding', () => {
  const qualifyingCases = Array.from({ length: 12 }, (_, i) => ({
    suiteOrderIndex: i + 1,
    attemptId: `challenge-attempt-${String(i + 1).padStart(2, '0')}`,
    failureClass: R2_1_FAILURE_CLASSES[Math.floor(i / 4)],
    attemptOrderIndex: i + 1,
    casePacketHash: 'sha256:' + String(i + 1).padStart(2, '0').repeat(32),
  }));

  const hash = computeChallengeExecutionOrderHash(qualifyingCases);
  assert.match(hash, /^sha256:[a-f0-9]{64}$/);

  const hash2 = computeChallengeExecutionOrderHash(qualifyingCases);
  assert.equal(hash, hash2);
});

test('Gap C.3: mutating challenge qualifying case order or casePacketHash alters order hash', () => {
  const qualifyingCases = Array.from({ length: 12 }, (_, i) => ({
    suiteOrderIndex: i + 1,
    attemptId: `challenge-attempt-${String(i + 1).padStart(2, '0')}`,
    failureClass: R2_1_FAILURE_CLASSES[Math.floor(i / 4)],
    attemptOrderIndex: i + 1,
    casePacketHash: 'sha256:' + String(i + 1).padStart(2, '0').repeat(32),
  }));
  const baseHash = computeChallengeExecutionOrderHash(qualifyingCases);

  const mutatedPacket = JSON.parse(JSON.stringify(qualifyingCases));
  mutatedPacket[0].casePacketHash = 'sha256:' + 'f'.repeat(64);
  const mutatedPacketHash = computeChallengeExecutionOrderHash(mutatedPacket);
  assert.notEqual(baseHash, mutatedPacketHash);

  const swappedOrder = JSON.parse(JSON.stringify(qualifyingCases));
  swappedOrder[0].suiteOrderIndex = 2;
  swappedOrder[1].suiteOrderIndex = 1;
  const swappedHash = computeChallengeExecutionOrderHash(swappedOrder);
  assert.notEqual(baseHash, swappedHash);

  const duplicateIndex = JSON.parse(JSON.stringify(qualifyingCases));
  duplicateIndex[0].suiteOrderIndex = 2;
  assert.throws(() => computeChallengeExecutionOrderHash(duplicateIndex), /Invalid or non-sequential suiteOrderIndex/);
});

// =========================================================================
// POSITIVE SYNTHETIC FIXTURE TEST
// =========================================================================

test('Positive: complete synthetic EXECUTION_READY fixture passes all 3 layers and Git checkpoint', () => {
  const { tempRepoDir, freezeRecord, cleanup } = createSyntheticGitRepoFixture();
  try {
    const res = validateProspectiveFreezeRecord(freezeRecord, {
      workspaceRoot: tempRepoDir,
      requireExecutionReady: true,
    });
    assert.equal(res.status, 'EXECUTION_READY');
    assert.equal(res.isExecutionReady, true);
  } finally {
    cleanup();
  }
});

// =========================================================================
// TARGETED INTEGRITY TESTS: ISSUE 1 & ISSUE 2 (PRE-CHECKPOINT FINALIZATION)
// =========================================================================

test('Targeted 1: challenge hashes and prohibited hashes use different derivation scheme -> FAIL', () => {
  const { tempRepoDir, freezeRecord, cleanup } = createSyntheticGitRepoFixture();
  try {
    const poolPath = path.join(tempRepoDir, freezeRecord.challengePoolAndExclusionCommitment.path);
    const poolJson = JSON.parse(fs.readFileSync(poolPath, 'utf8'));
    // Alter developmentCohort derivationScheme to an unkeyed scheme
    poolJson.prohibitedCohorts.developmentCohort.sourceMembershipCommitment.derivationScheme = 'UNKEYED_SHA256_MOCK';
    poolJson.prohibitedCohorts.developmentCohort.derivationScheme = 'UNKEYED_SHA256_MOCK';
    const updatedContent = JSON.stringify(poolJson, null, 2);
    fs.writeFileSync(poolPath, updatedContent, 'utf8');
    freezeRecord.challengePoolAndExclusionCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(updatedContent));

    assert.throws(
      () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot: tempRepoDir, requireExecutionReady: true }),
      /derivationScheme/i
    );
  } finally {
    cleanup();
  }
});

test('Targeted 2: same scheme but different derivationKeyCommitment -> FAIL', () => {
  const { tempRepoDir, freezeRecord, cleanup } = createSyntheticGitRepoFixture();
  try {
    const poolPath = path.join(tempRepoDir, freezeRecord.challengePoolAndExclusionCommitment.path);
    const poolJson = JSON.parse(fs.readFileSync(poolPath, 'utf8'));
    // Alter developmentCohort derivationKeyCommitment to a different commitment
    poolJson.prohibitedCohorts.developmentCohort.sourceMembershipCommitment.derivationKeyCommitment = 'sha256:' + '8'.repeat(64);
    poolJson.prohibitedCohorts.developmentCohort.derivationKeyCommitment = 'sha256:' + '8'.repeat(64);
    const updatedContent = JSON.stringify(poolJson, null, 2);
    fs.writeFileSync(poolPath, updatedContent, 'utf8');
    freezeRecord.challengePoolAndExclusionCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(updatedContent));

    assert.throws(
      () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot: tempRepoDir, requireExecutionReady: true }),
      /derivationKeyCommitment mismatch/
    );
  } finally {
    cleanup();
  }
});

test('Targeted 3: attempt candidate-member reference absent from challenge source set -> FAIL', () => {
  const { tempRepoDir, freezeRecord, cleanup } = createSyntheticGitRepoFixture();
  try {
    const attemptPath = path.join(tempRepoDir, freezeRecord.challengeAttemptManifestCommitment.path);
    const attemptJson = JSON.parse(fs.readFileSync(attemptPath, 'utf8'));
    attemptJson.attempts[0].sourceCandidateMemberReferenceHash = 'sha256:' + '7'.repeat(64);
    const updatedContent = JSON.stringify(attemptJson, null, 2);
    fs.writeFileSync(attemptPath, updatedContent, 'utf8');
    const newAttemptSha = 'sha256:' + computeSha256(Buffer.from(updatedContent));
    freezeRecord.challengeAttemptManifestCommitment.sha256 = newAttemptSha;

    const qualPath = path.join(tempRepoDir, freezeRecord.challengeQualificationManifestCommitment.path);
    const qualJson = JSON.parse(fs.readFileSync(qualPath, 'utf8'));
    qualJson.attemptManifestSha256 = newAttemptSha;
    const updatedQualContent = JSON.stringify(qualJson, null, 2);
    fs.writeFileSync(qualPath, updatedQualContent, 'utf8');
    freezeRecord.challengeQualificationManifestCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(updatedQualContent));

    assert.throws(
      () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot: tempRepoDir, requireExecutionReady: true }),
      /is not present in exclusion-proven challengeSourceMemberHashes/
    );
  } finally {
    cleanup();
  }
});

test('Targeted 4: attempt reference is a packet-content hash under a different declared domain -> FAIL', () => {
  const { tempRepoDir, freezeRecord, cleanup } = createSyntheticGitRepoFixture();
  try {
    const attemptPath = path.join(tempRepoDir, freezeRecord.challengeAttemptManifestCommitment.path);
    const attemptJson = JSON.parse(fs.readFileSync(attemptPath, 'utf8'));
    // Point sourceCandidateMemberReferenceHash to the raw packet hash which is not in the HMAC challenge set
    attemptJson.attempts[0].sourceCandidateMemberReferenceHash = attemptJson.attempts[0].sourcePacketReferenceHash;
    const updatedContent = JSON.stringify(attemptJson, null, 2);
    fs.writeFileSync(attemptPath, updatedContent, 'utf8');
    const newAttemptSha = 'sha256:' + computeSha256(Buffer.from(updatedContent));
    freezeRecord.challengeAttemptManifestCommitment.sha256 = newAttemptSha;

    const qualPath = path.join(tempRepoDir, freezeRecord.challengeQualificationManifestCommitment.path);
    const qualJson = JSON.parse(fs.readFileSync(qualPath, 'utf8'));
    qualJson.attemptManifestSha256 = newAttemptSha;
    const updatedQualContent = JSON.stringify(qualJson, null, 2);
    fs.writeFileSync(qualPath, updatedQualContent, 'utf8');
    freezeRecord.challengeQualificationManifestCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(updatedQualContent));

    assert.throws(
      () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot: tempRepoDir, requireExecutionReady: true }),
      /is not present in exclusion-proven challengeSourceMemberHashes/
    );
  } finally {
    cleanup();
  }
});

test('Targeted 5: replacement holdout key commitment differs -> FAIL', () => {
  const { tempRepoDir, freezeRecord, cleanup } = createSyntheticGitRepoFixture();
  try {
    const holdoutPath = path.join(tempRepoDir, freezeRecord.replacementHoldoutCommitment.path);
    const holdoutJson = JSON.parse(fs.readFileSync(holdoutPath, 'utf8'));
    // Alter holdout key commitment
    holdoutJson.derivationKeyCommitment = 'sha256:' + 'e'.repeat(64);
    const updatedContent = JSON.stringify(holdoutJson, null, 2);
    fs.writeFileSync(holdoutPath, updatedContent, 'utf8');
    freezeRecord.replacementHoldoutCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(updatedContent));

    assert.throws(
      () => validateProspectiveFreezeRecord(freezeRecord, { workspaceRoot: tempRepoDir, requireExecutionReady: true }),
      /[Dd]erivation.*[Kk]ey.*[Cc]ommitment.*mismatch/
    );
  } finally {
    cleanup();
  }
});

test('Targeted 6: all four cohort sets + challenge set use one common synthetic HMAC domain -> PASS', () => {
  const { tempRepoDir, freezeRecord, cleanup } = createSyntheticGitRepoFixture();
  try {
    const res = validateProspectiveFreezeRecord(freezeRecord, {
      workspaceRoot: tempRepoDir,
      requireExecutionReady: true,
    });
    assert.equal(res.status, 'EXECUTION_READY');
    assert.equal(res.isExecutionReady, true);
  } finally {
    cleanup();
  }
});

test('canonical freeze-preparation manifest exactly binds current governed toolchain', () => {
  const realManifestRelPath = 'catalogue-pipeline/experiments/verifier-v1.4-prospective-validation/r2.1/freeze-preparation/freeze-preparation-manifest.v1.json';
  const realManifestPath = path.join(workspaceRoot, realManifestRelPath);
  assert.equal(fs.existsSync(realManifestPath), true, 'Manifest file must exist in repository');

  const raw = fs.readFileSync(realManifestPath, 'utf8');
  const manifest = JSON.parse(raw);

  // Exact top-level identity
  assert.equal(manifest.schemaVersion, 'freeze-preparation-manifest.v1');
  assert.equal(manifest.manifestId, 'freeze-preparation-manifest.r2.1');
  assert.equal(manifest.protocolId, 'source-boundary-risk-verifier.v1.4-prospective-validation.r2.1');

  // Exactly one canonical toolchainFiles mapping, no governedFiles field
  assert.ok(manifest.toolchainFiles && typeof manifest.toolchainFiles === 'object');
  assert.equal('governedFiles' in manifest, false, 'Manifest must NOT contain legacy governedFiles mapping');
  assert.equal(manifest.governedFiles, undefined);

  // Exact path set == R2_1_EXPECTED_TOOLCHAIN_FILES
  const manifestKeys = Object.keys(manifest.toolchainFiles).sort();
  const expectedKeys = [...R2_1_EXPECTED_TOOLCHAIN_FILES].sort();
  assert.deepEqual(manifestKeys, expectedKeys, 'toolchainFiles keys must exactly match R2_1_EXPECTED_TOOLCHAIN_FILES');

  // Every hash equals the actual current filesystem bytes
  for (const relPath of expectedKeys) {
    const fullPath = path.join(workspaceRoot, relPath);
    assert.equal(fs.existsSync(fullPath), true, `Governed file must exist on filesystem: ${relPath}`);
    const actualSha = 'sha256:' + computeSha256(fs.readFileSync(fullPath));
    const committedSha = manifest.toolchainFiles[relPath];
    assert.equal(committedSha, actualSha, `Hash in toolchainFiles for ${relPath} must equal current filesystem bytes`);
  }
});

test('Targeted 8: stale toolchainFiles hash -> FAIL', () => {
  const { tempRepoDir, freezeRecord, toolchainManifestObj, toolchainManifestRel, cleanup } = createSyntheticGitRepoFixture();
  try {
    const corruptedObj = JSON.parse(JSON.stringify(toolchainManifestObj));
    corruptedObj.toolchainFiles[R2_1_EXPECTED_TOOLCHAIN_FILES[0]] = 'sha256:' + '0'.repeat(64);
    const corruptedContent = JSON.stringify(corruptedObj, null, 2);
    const fullManifestPath = path.join(tempRepoDir, toolchainManifestRel);
    fs.writeFileSync(fullManifestPath, corruptedContent, 'utf8');
    freezeRecord.freezeValidationToolchainCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(corruptedContent));

    assert.throws(
      () => validateProspectiveFreezeRecord(freezeRecord, {
        workspaceRoot: tempRepoDir,
        requireExecutionReady: true,
      }),
      /SHA[-_]?(256)?.*(mismatch|Hash verification failed)/i
    );
  } finally {
    cleanup();
  }
});

test('Targeted 9: governedFiles parallel mapping present -> FAIL', () => {
  const { tempRepoDir, freezeRecord, toolchainManifestObj, toolchainManifestRel, cleanup } = createSyntheticGitRepoFixture();
  try {
    const parallelObj = JSON.parse(JSON.stringify(toolchainManifestObj));
    parallelObj.governedFiles = { ...parallelObj.toolchainFiles };
    const parallelContent = JSON.stringify(parallelObj, null, 2);
    const fullManifestPath = path.join(tempRepoDir, toolchainManifestRel);
    fs.writeFileSync(fullManifestPath, parallelContent, 'utf8');
    freezeRecord.freezeValidationToolchainCommitment.sha256 = 'sha256:' + computeSha256(Buffer.from(parallelContent));

    assert.throws(
      () => validateProspectiveFreezeRecord(freezeRecord, {
        workspaceRoot: tempRepoDir,
        requireExecutionReady: true,
      }),
      /governedFiles.*(mapping|permitted|prohibited)/i
    );
  } finally {
    cleanup();
  }
});
