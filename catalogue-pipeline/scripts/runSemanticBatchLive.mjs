import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createGeminiProvider } from '../adapters/geminiProvider.ts'
import { discoverLargestEvidenceSet, runSemanticBatch, SemanticBatchError } from './runSemanticBatch.mjs'

const AUTHORIZATION_FLAG = '--execute-authorized-semantic-batch'
const MAX_FRESH_CALLS_FLAG = '--max-fresh-calls'

function parseArgs(argv) {
  const [command = 'dry-run', runId, ...flags] = argv
  if (!['dry-run', 'run', 'resume'].includes(command)) throw new SemanticBatchError('Command must be dry-run, run, or resume.', { code: 'INVALID_BATCH_COMMAND' })
  if (!runId || !/^[A-Za-z0-9._-]+$/.test(runId)) throw new SemanticBatchError('A safe immutable run ID is required.', { code: 'INVALID_RUN_ID' })
  const index = flags.indexOf(MAX_FRESH_CALLS_FLAG)
  const maxFreshCalls = index === -1 ? Infinity : Number(flags[index + 1])
  if (maxFreshCalls !== Infinity && (!Number.isInteger(maxFreshCalls) || maxFreshCalls < 0)) throw new SemanticBatchError('max-fresh-calls must be a nonnegative integer.', { code: 'INVALID_MAX_FRESH_CALLS' })
  return { command, runId, authorized: flags.includes(AUTHORIZATION_FLAG), maxFreshCalls }
}

export async function launchSemanticBatch(argv = process.argv.slice(2), { env = process.env } = {}) {
  const { command, runId, authorized, maxFreshCalls } = parseArgs(argv)
  const root = resolve('catalogue-pipeline')
  const promptVersion = 'semantic-classifier.v3'
  const schemaVersion = 'semantic-output.v2'
  const modelId = env.GEMINI_MODEL?.trim() || 'gemini-3.7-flash'
  const packets = await discoverLargestEvidenceSet(resolve(root, 'generated/semantic'))
  const prompt = await readFile(resolve(root, 'prompts/semantic-classifier.v3.md'), 'utf8')
  const paths = { cacheRoot: resolve(root, 'cache/semantic'), outputRoot: resolve(root, 'generated/semantic/batches', runId), runRoot: resolve(root, 'generated/semantic/batches') }
  if (command === 'dry-run' || !authorized) {
    const provider = { metadata: { providerId: 'google-gemini-developer-api', modelId } }
    const projection = await runSemanticBatch({ runId, evidencePackets: packets, provider, prompt, promptVersion, schemaVersion, ...paths, dryRun: true, maxFreshCalls })
    return { ...projection, executionAuthorized: false, command }
  }
  if (!env.GEMINI_API_KEY) throw new SemanticBatchError('GEMINI_API_KEY is required for authorized execution.', { code: 'MISSING_GEMINI_API_KEY' })
  const provider = createGeminiProvider({ modelId, env })
  return { ...(await runSemanticBatch({ runId, evidencePackets: packets, provider, prompt, promptVersion, schemaVersion, ...paths, maxFreshCalls })), executionAuthorized: true, command }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  launchSemanticBatch().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(`${error.message} [${error.code ?? 'ERROR'}]`); process.exitCode = 1 })
}
