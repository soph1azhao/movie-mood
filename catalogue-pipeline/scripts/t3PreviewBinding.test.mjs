import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { hashArtifact } from './validatePromotionContract.mjs'
import { validateFinalPreviewBinding } from './t3PreviewBinding.mjs'

const without = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'artifactHash'))
const v2 = () => { const preview={candidateId:'fixture',output:{copy:{description:'A'.repeat(80),whyWatch:'B'.repeat(60),curiosityHook:'C'.repeat(50),vibeSummary:'D'.repeat(45)}},status:'LINT_PASS'};preview.artifactHash=hashArtifact(without(preview));return preview }

test('V2 self-hash binding accepts its historical domain, not full-artifact hashing',()=>{
 const preview=v2(),expected=preview.artifactHash
 assert.notEqual(hashArtifact(preview),expected)
 assert.equal(validateFinalPreviewBinding({preview,expectedFinalPreviewHash:expected,routeProvenance:'V2_LINT_PASS'}),true)
})

test('V2 binding rejects stale self hashes, changed self hashes, and wrong expected hashes',()=>{
 for(const mutate of [p=>p.output.copy.description='Z'.repeat(80),p=>p.status='OTHER',p=>p.artifactHash='sha256:'+'0'.repeat(64)]){const preview=v2();mutate(preview);assert.equal(validateFinalPreviewBinding({preview,expectedFinalPreviewHash:v2().artifactHash,routeProvenance:'V2_LINT_PASS'}),false)}
})

test('original route preserves whole-artifact historical hashing',()=>{
 const preview={candidateId:'original',output:{copy:{description:'x'}}};const expected=hashArtifact(preview)
 assert.equal(validateFinalPreviewBinding({preview,expectedFinalPreviewHash:expected,routeProvenance:'ORIGINAL_STAGE1_LINT_PASS'}),true)
 assert.equal(validateFinalPreviewBinding({preview:{...preview,metadata:'changed'},expectedFinalPreviewHash:expected,routeProvenance:'ORIGINAL_STAGE1_LINT_PASS'}),false)
})

test('execution checks preview binding before copy use or durable attempt persistence',()=>{
 const source=fs.readFileSync(path.join(import.meta.dirname,'t3PostClosureReworkExecution.mjs'),'utf8')
 const binding=source.indexOf("'PREVIEW_BINDING_INVALID'")
 const copy=source.indexOf('const copy=structuredClone(preview.output.copy)')
 const persist=source.indexOf('write(repoRoot,p,artifact)')
 assert.ok(binding>=0 && binding<copy && copy<persist)
})
