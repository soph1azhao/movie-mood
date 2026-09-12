import { pathToFileURL } from 'node:url'
import { V4_STAGE2_AUTHORIZATION, runV4Stage2 } from './c1bV4Stage2Runner.mjs'

export async function main({ argv = process.argv.slice(2), run = runV4Stage2 } = {}) {
  if (argv.length !== 1 || argv[0] !== V4_STAGE2_AUTHORIZATION) return { status: 'NOT_AUTHORIZED', dispatchedRequests: 0 }
  return run({ authorization: V4_STAGE2_AUTHORIZATION })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((result) => { console.log(JSON.stringify(result, null, 2)); if (result.status !== 'COMPLETE') process.exitCode = 1 }).catch((error) => { console.error(error); process.exitCode = 1 })
}
