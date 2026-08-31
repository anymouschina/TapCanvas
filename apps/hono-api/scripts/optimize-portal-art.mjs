#!/usr/bin/env node

import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { buildObjectStorageUrl, resolveObjectStorageTarget, toHostedAssetKey } from './object-storage-config.mjs'

const execFileAsync = promisify(execFile)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))

async function loadEnv() {
  const envPath = path.join(scriptDir, '../.env')
  const content = await fs.readFile(envPath, 'utf8')
  for (const line of content.split('\n')) {
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (key && !process.env[key]) process.env[key] = value
  }
}

function requireEnv(key) {
  const value = process.env[key]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${key}`)
  return value
}

const sourceKeys = [
  'static/portal/tc-home-hero-v1-20260721.png',
  'static/portal/tc-home-production-1-v1-20260721.png',
  'static/portal/tc-home-production-2-v1-20260721.png',
  'static/portal/tc-home-production-3-v1-20260721.png',
  'static/portal/tc-home-production-4-v1-20260721.png',
  'static/portal/tc-home-capability-creative-agent-v1-20260721.png',
  'static/portal/tc-home-capability-image-craft-v1-20260721.png',
  'static/portal/tc-home-capability-video-craft-v1-20260721.png',
  'static/portal/tc-home-capability-sound-craft-v1-20260721.png',
]

function toTargetKey(sourceKey) {
  const targetKey = sourceKey.replace('-v1-20260721.png', '-v2-20260722.webp')
  if (targetKey === sourceKey) throw new Error(`Unexpected portal asset key: ${sourceKey}`)
  return targetKey
}

await loadEnv()

const storage = resolveObjectStorageTarget()
const { bucket } = storage
const s3 = new S3Client(storage.s3ClientConfig)

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tapcanvas-portal-webp-'))

for (const sourceKey of sourceKeys) {
  const sourceObjectKey = toHostedAssetKey(storage.provider, sourceKey)
  const sourceUrl = buildObjectStorageUrl(storage.publicBase, sourceObjectKey)
  const sourceResponse = await fetch(sourceUrl, { signal: AbortSignal.timeout(90_000) })
  if (!sourceResponse.ok) {
    throw new Error(`Portal asset download failed [${sourceResponse.status}]: ${sourceUrl}`)
  }

  const fileStem = path.basename(sourceKey, '.png')
  const sourcePath = path.join(tempDir, `${fileStem}.png`)
  const targetPath = path.join(tempDir, `${fileStem}.webp`)
  const sourceBytes = Buffer.from(await sourceResponse.arrayBuffer())
  await fs.writeFile(sourcePath, sourceBytes)
  await execFileAsync('cwebp', ['-quiet', '-q', '82', '-mt', sourcePath, '-o', targetPath])

  const targetBytes = await fs.readFile(targetPath)
  const targetKey = toHostedAssetKey(storage.provider, toTargetKey(sourceKey))
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: targetKey,
    Body: targetBytes,
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000, immutable',
  }))

  console.log(JSON.stringify({
    sourceBytes: sourceBytes.byteLength,
    targetBytes: targetBytes.byteLength,
    url: buildObjectStorageUrl(storage.publicBase, targetKey),
  }))
}

console.log(`Temporary conversion files: ${tempDir}`)
