#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { config as loadEnv } from 'dotenv'
import { buildObjectStorageUrl, resolveObjectStorageTarget } from './object-storage-config.mjs'

const execFileAsync = promisify(execFile)
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
loadEnv({ path: path.resolve(scriptDirectory, '../.env') })

const caseManifestPath = process.argv[2] || path.resolve(scriptDirectory, '../results/oiioii-skill-cases.json')
const outputPath = process.argv[3] || path.resolve(scriptDirectory, '../results/oiioii-skill-covers.json')
const caseManifest = JSON.parse(fs.readFileSync(caseManifestPath, 'utf8'))
if (caseManifest?.complete !== true || !Array.isArray(caseManifest.cases) || caseManifest.cases.length !== 38) {
  throw new Error('The complete 38-item OiiOii case manifest is required')
}

const merchandiseCovers = [
  ['吧唧', 'https://static-oiioii-sg.hogiai.cn/skill_cases/aonzycxf_02c23ee95c7e309c.webp'],
  ['亚克力牌', 'https://static-oiioii-sg.hogiai.cn/skill_cases/hnlnheuv_d97fefeb0d415f53.webp'],
  ['贴纸', 'https://static-oiioii-sg.hogiai.cn/skill_cases/mput7uzv_2022442bbe91c0a7.webp'],
  ['手办模型', 'https://static-oiioii-sg.hogiai.cn/skill_cases/jcyvnfdf_9bf6ddff753b0a52.webp'],
  ['拼豆', 'https://static-oiioii-sg.hogiai.cn/skill_cases/raajnjix_ee211bd400837860.webp'],
  ['钥匙扣', 'https://static-oiioii-sg.hogiai.cn/skill_cases/mpw8yclp_b5835f1b95d534e1.webp'],
  ['痛包', 'https://static-oiioii-sg.hogiai.cn/skill_cases/mpw8ekbw_96a65984ca90fd0d.webp'],
  ['手机壳', 'https://static-oiioii-sg.hogiai.cn/skill_cases/mumxqerc_daf002474e7cda36.webp'],
  ['CP拍立得', 'https://static-oiioii-sg.hogiai.cn/skill_cases/hiscjcid_cb80dce77c430fde.webp'],
  ['鼠标垫', 'https://static-oiioii-sg.hogiai.cn/skill_cases/mpwasrqb_f031f3f310e8f41f.webp'],
  ['周边墙', 'https://static-oiioii-sg.hogiai.cn/skill_cases/mpw1lg7j_cc423c73902b74b4.webp'],
]

const storage = resolveObjectStorageTarget()
const client = new S3Client({ ...storage.s3ClientConfig, maxAttempts: 1 })
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tapcanvas-oiioii-covers-'))

async function uploadCover(bytes, index, sourceType, sourceUrl, extension, contentType) {
  const hash = createHash('sha256').update(bytes).digest('hex')
  const key = `portal/skills/oiioii/covers/${String(index + 1).padStart(2, '0')}-${hash.slice(0, 16)}.${extension}`
  await client.send(new PutObjectCommand({
    Bucket: storage.bucket,
    Key: key,
    Body: bytes,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }))
  return {
    index,
    sourceType,
    sourceUrl,
    assetUrl: buildObjectStorageUrl(storage.publicBase, key),
    key,
    contentType,
    size: bytes.length,
    sha256: hash,
  }
}

async function extractVideoCover(item, index) {
  const outputFile = path.join(tempDirectory, `${String(index + 1).padStart(2, '0')}.jpg`)
  process.stdout.write(`[${index + 1}/49] extracting video cover\n`)
  await execFileAsync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', '0.5', '-i', item.assetUrl,
    '-frames:v', '1', '-vf', 'scale=960:540:force_original_aspect_ratio=increase,crop=960:540',
    '-q:v', '3', outputFile,
  ], { timeout: 180_000, maxBuffer: 1024 * 1024 })
  return await uploadCover(fs.readFileSync(outputFile), index, 'case-video-frame', item.assetUrl, 'jpg', 'image/jpeg')
}

async function copyMerchandiseCover(item, offset) {
  const [name, sourceUrl] = item
  const index = offset + 38
  process.stdout.write(`[${index + 1}/49] downloading ${name}\n`)
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`Cover download failed (${response.status}): ${sourceUrl}`)
  return await uploadCover(Buffer.from(await response.arrayBuffer()), index, 'oiioii-cover', sourceUrl, 'webp', 'image/webp')
}

try {
  const covers = []
  for (let index = 0; index < caseManifest.cases.length; index += 1) {
    const cover = await extractVideoCover(caseManifest.cases[index], index)
    covers.push(cover)
    process.stdout.write(`[${index + 1}/49] uploaded ${cover.assetUrl}\n`)
  }
  for (let offset = 0; offset < merchandiseCovers.length; offset += 1) {
    const cover = await copyMerchandiseCover(merchandiseCovers[offset], offset)
    covers.push(cover)
    process.stdout.write(`[${cover.index + 1}/49] uploaded ${cover.assetUrl}\n`)
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify({ importedAt: new Date().toISOString(), provider: storage.provider, complete: true, covers }, null, 2)}\n`)
  process.stdout.write(`Manifest written to ${outputPath}\n`)
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true })
}
