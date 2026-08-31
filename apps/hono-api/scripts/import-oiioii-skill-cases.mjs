#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { config as loadEnv } from 'dotenv'
import { buildObjectStorageUrl, resolveObjectStorageTarget } from './object-storage-config.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
loadEnv({ path: path.resolve(scriptDirectory, '../.env') })

const sourceHtmlPath = process.argv[2] || '/tmp/oiioii-case.html'
const outputPath = process.argv[3] || path.resolve(scriptDirectory, '../results/oiioii-skill-cases.json')
const sourceHtml = fs.readFileSync(sourceHtmlPath, 'utf8')
const urlPattern = /https?:[^"' ]+\.(?:mp4|webm|mov)[^"' <]*/g
const orderedSourceUrls = [...new Set(sourceHtml.match(urlPattern) || [])]

if (orderedSourceUrls.length !== 38) {
  throw new Error(`Expected 38 unique OiiOii case videos, received ${orderedSourceUrls.length}`)
}

const storage = resolveObjectStorageTarget()
const client = new S3Client({
  ...storage.s3ClientConfig,
  maxAttempts: 1,
})

async function importVideo(sourceUrl, index) {
  process.stdout.write(`[${index + 1}/${orderedSourceUrls.length}] downloading ${sourceUrl}\n`)
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(180_000) })
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${sourceUrl}`)
  const contentType = response.headers.get('content-type')?.split(';')[0].trim() || 'video/mp4'
  if (!contentType.startsWith('video/')) throw new Error(`Unexpected content type ${contentType}: ${sourceUrl}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length) throw new Error(`Downloaded an empty video: ${sourceUrl}`)
  const hash = createHash('sha256').update(bytes).digest('hex')
  const extension = contentType === 'video/webm' ? 'webm' : contentType === 'video/quicktime' ? 'mov' : 'mp4'
  const key = `portal/skills/oiioii/cases/${String(index + 1).padStart(2, '0')}-${hash.slice(0, 16)}.${extension}`
  process.stdout.write(`[${index + 1}/${orderedSourceUrls.length}] uploading ${bytes.length} bytes\n`)
  await client.send(new PutObjectCommand({
    Bucket: storage.bucket,
    Key: key,
    Body: bytes,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }))
  return {
    index,
    sourceUrl,
    assetUrl: buildObjectStorageUrl(storage.publicBase, key),
    key,
    contentType,
    size: bytes.length,
    sha256: hash,
  }
}

const previousManifest = fs.existsSync(outputPath) ? JSON.parse(fs.readFileSync(outputPath, 'utf8')) : null
const imported = Array.isArray(previousManifest?.cases) ? previousManifest.cases : []
for (let index = imported.length; index < orderedSourceUrls.length; index += 1) {
  const result = await importVideo(orderedSourceUrls[index], index)
  imported.push(result)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify({ importedAt: new Date().toISOString(), provider: storage.provider, complete: false, cases: imported }, null, 2)}\n`)
  process.stdout.write(`[${index + 1}/${orderedSourceUrls.length}] uploaded ${result.assetUrl}\n`)
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify({ importedAt: new Date().toISOString(), provider: storage.provider, complete: true, cases: imported }, null, 2)}\n`)
process.stdout.write(`Manifest written to ${outputPath}\n`)
