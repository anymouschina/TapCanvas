#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { buildObjectStorageUrl, resolveObjectStorageTarget, toHostedAssetKey } from './object-storage-config.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))

function loadEnv() {
  const envPath = path.join(scriptDir, '../.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
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

loadEnv()

const newApiBase = (process.env.NEW_API_INTERNAL_BASE_URL || 'http://localhost:4455')
  .replace('new-api', 'localhost')
  .replace(/\/+$/, '')
const newApiToken = requireEnv('NEW_API_INTERNAL_TOKEN')
const storage = resolveObjectStorageTarget()
const s3 = new S3Client(storage.s3ClientConfig)
const sourceUrlArgument = process.argv.find((value) => value.startsWith('--source-url='))
const sourceUrl = sourceUrlArgument?.slice('--source-url='.length).trim() || ''

const prompt = [
  'Use case: stylized-concept.',
  'Asset type: tiny circular image used as the collapsed filter launcher in the TapCanvas prompt library toolbar.',
  'Create one premium abstract glass sphere, centered and filling almost the entire square canvas.',
  'The sphere is made from smoked graphite glass with a soft liquid-silver core, subtle concentric depth, and one restrained warm pearl glint.',
  'It should feel like a miniature creative portal or polished optical lens, not a UI glyph and not a conventional icon.',
  'Front-facing symmetrical composition, perfectly circular silhouette, generous edge clarity, crisp at 42 pixels, refined studio product lighting.',
  'Background is flat near-black #151517 and must reach every corner so the artwork blends into the dark toolbar.',
  'Color palette is neutral charcoal, silver, pearl gray, and a very small warm ivory highlight. Low saturation and high material realism.',
  'No text, no letters, no logo, no arrows, no sliders, no filter symbol, no hamburger menu, no sparkles, no stars, no blue or purple glow, no colored gradient, no border, no watermark, no extra objects.',
].join('\n')

async function generateImage() {
  if (sourceUrl) {
    const imageResponse = await fetch(sourceUrl, { signal: AbortSignal.timeout(90_000) })
    if (!imageResponse.ok) throw new Error(`Recovered prompt toolbar orb download failed [${imageResponse.status}]`)
    return new Uint8Array(await imageResponse.arrayBuffer())
  }

  const response = await fetch(`${newApiBase}/v1/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${newApiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-2',
      prompt,
      n: 1,
      size: '1:1',
      resolution: '2K',
      quality: 'high',
      response_format: 'url',
      user: 'tapcanvas-prompt-toolbar-orb',
    }),
    signal: AbortSignal.timeout(960_000),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Prompt toolbar orb generation failed [${response.status}]: ${detail.slice(0, 300)}`)
  }

  const payload = await response.json()
  const item = payload?.data?.[0]
  if (typeof item?.url === 'string' && item.url) {
    const imageResponse = await fetch(item.url, { signal: AbortSignal.timeout(90_000) })
    if (!imageResponse.ok) throw new Error(`Prompt toolbar orb download failed [${imageResponse.status}]`)
    return new Uint8Array(await imageResponse.arrayBuffer())
  }
  if (typeof item?.b64_json === 'string' && item.b64_json) {
    return Buffer.from(item.b64_json, 'base64')
  }
  throw new Error('Prompt toolbar orb response did not include an image URL or base64 payload')
}

async function run() {
  const bytes = await generateImage()
  const objectKey = toHostedAssetKey(
    storage.provider,
    'static/portal/prompt-toolbar-orb-v1-20260825.png',
  )
  await s3.send(new PutObjectCommand({
    Bucket: storage.bucket,
    Key: objectKey,
    Body: bytes,
    ContentType: 'image/png',
    CacheControl: 'public, max-age=31536000, immutable',
  }))
  const url = buildObjectStorageUrl(storage.publicBase, objectKey)
  console.log(JSON.stringify({ url, prompt }, null, 2))
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
