// Initial-execution-only launcher. Importing this module has no network side effects.

import { fileURLToPath } from 'node:url'
import { createC1bV3TmdbTransport } from '../adapters/c1bV3TmdbTransport.mjs'
import { loadFrozenV3Stage1RunConfiguration } from './c1bV3Stage1PreLive.mjs'
import { runV3Stage1Recruitment } from './c1bV3Stage1Runner.mjs'

export const V3_STAGE1_EXECUTION_FLAG = '--execute-authorized-v3-stage1'

export class C1bV3LiveLauncherError extends Error {
  constructor(message, code = 'C1B_V3_LIVE_LAUNCHER_ERROR') { super(message); this.name = 'C1bV3LiveLauncherError'; this.code = code }
}

const fail = (message, code) => { throw new C1bV3LiveLauncherError(message, code) }

export function createC1bV3SafeSummary(result, artifactDir) {
  return {
    status: result.status,
    ...(result.reason ? { reason: result.reason } : {}),
    dispatchedRequests: result.dispatchedRequests,
    maxConcurrency: result.maxConcurrency,
    ...(result.sourceSnapshotHash ? { sourceSnapshotHash: result.sourceSnapshotHash } : {}),
    ...(result.selection?.finalCandidateCount !== undefined ? { finalCandidateCount: result.selection.finalCandidateCount } : {}),
    artifactDir,
  }
}

export async function runAuthorizedC1bV3Stage1({
  authorizationFlag,
  root = process.cwd(),
  env = process.env,
  fetchImpl = globalThis.fetch,
  loadFrozenConfiguration = loadFrozenV3Stage1RunConfiguration,
  createTransport = createC1bV3TmdbTransport,
  runRecruitment = runV3Stage1Recruitment,
  now = () => new Date().toISOString(),
  log = console.log,
} = {}) {
  if (authorizationFlag !== V3_STAGE1_EXECUTION_FLAG) fail('Explicit V3 Stage-1 live authorization is required.', 'LIVE_AUTHORIZATION_REQUIRED')
  const configuration = await loadFrozenConfiguration({ root })
  const token = env.TMDB_READ_ACCESS_TOKEN
  if (typeof token !== 'string' || token.length === 0) fail('BLOCKED — TMDB CREDENTIAL NOT PRESENT', 'TMDB_CREDENTIAL_MISSING')
  const timestamp = now()
  const transport = createTransport({ fetchImpl, token })
  const result = await runRecruitment({
    root,
    artifactDir: configuration.artifactDir,
    invocationId: configuration.invocationId,
    exclusionManifest: configuration.exclusionManifest,
    controlledResume: false,
    timestamp,
    transport,
  })
  const summary = createC1bV3SafeSummary(result, configuration.artifactDir)
  log(JSON.stringify(summary))
  return { result, summary, configuration }
}

export async function runC1bV3Stage1LiveCli({ argv = process.argv, ...dependencies } = {}) {
  if (argv.slice(2).length !== 1 || argv[2] !== V3_STAGE1_EXECUTION_FLAG) return { executed: false }
  return { executed: true, ...(await runAuthorizedC1bV3Stage1({ ...dependencies, authorizationFlag: argv[2] })) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runC1bV3Stage1LiveCli().catch((error) => {
    console.error(error.code === 'TMDB_CREDENTIAL_MISSING' ? error.message : 'V3 Stage-1 launcher failed.')
    process.exitCode = 1
  })
}
