import { createHash } from 'node:crypto'
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const contractsPath = join(repositoryRoot, 'catalogue-pipeline/calibration/diagnostics/phase5c-c1b-v-confirmatory.v3.contracts.json')

const rawSha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`

async function readFrozenSources() {
  const contracts = JSON.parse(await readFile(contractsPath, 'utf8'))
  const projection = contracts.contracts.find(({ id }) => id === 'wikipedia-excerpt-projection.v2')
  return [projection.canonicalContent.identityResolutionPolicy, projection.canonicalContent.extractionPolicy]
}

describe('V3 Stage-2 frozen Wikipedia policy sources', () => {
  it('reproduces each contract-declared source byte hash', async () => {
    for (const source of await readFrozenSources()) {
      const bytes = await readFile(join(repositoryRoot, source.sourcePath))
      expect(rawSha256(bytes)).toBe(source.sourceRawSha256)
    }
  })

  it('fails closed for a missing source or changed source bytes', async () => {
    const [source] = await readFrozenSources()
    const temporaryRoot = await mkdtemp(join(repositoryRoot, '.c1b-v3-source-integrity-'))
    try {
      const missingPath = join(temporaryRoot, 'missing.mjs')
      await expect(readFile(missingPath)).rejects.toMatchObject({ code: 'ENOENT' })

      const changedPath = join(temporaryRoot, 'changed.mjs')
      await writeFile(changedPath, Buffer.from('changed source bytes\n'))
      const changedBytes = await readFile(changedPath)
      expect(rawSha256(changedBytes)).not.toBe(source.sourceRawSha256)
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })
})
